package service_test

import (
	"context"
	"testing"

	"github.com/ethanrous/weblens/database"
	"github.com/ethanrous/weblens/internal/env"
	"github.com/ethanrous/weblens/internal/log"
	"github.com/ethanrous/weblens/internal/tests"
	"github.com/ethanrous/weblens/internal/werror"
	"github.com/ethanrous/weblens/models"
	. "github.com/ethanrous/weblens/service"
	"github.com/ethanrous/weblens/service/mock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func init() {
	if mondb == nil {
		var err error
		mondb, err = database.ConnectToMongo(env.GetMongoURI(), env.GetMongoDBName(env.Config{})+"-test")
		if err != nil {
			panic(err)
		}
	}
}

func TestInstanceServiceImpl_Add(t *testing.T) {
	t.Parallel()

	col := mondb.Collection(t.Name())
	err := col.Drop(context.Background())
	if err != nil {
		panic(err)
	}
	defer col.Drop(context.Background())

	is, err := NewInstanceService(col)
	require.NoError(t, err)

	if !assert.NotNil(t, is.GetLocal()) {
		t.FailNow()
	}
	assert.Equal(t, models.InitServerRole, is.GetLocal().GetRole())

	localInstance := models.NewInstance("", "My server", "", models.CoreServerRole, true, "", t.Name())
	assert.NotEmpty(t, localInstance.ServerId())

	err = is.Add(localInstance)
	assert.NoError(t, err)
	// assert.ErrorIs(t, err, werror.ErrDuplicateLocalServer)

	remoteId := models.InstanceId(primitive.NewObjectID().Hex())
	remoteBackup := models.NewInstance(
		remoteId, "My remote server", "deadbeefdeadbeef", models.BackupServerRole, false,
		"http://notrighthere.com", t.Name(),
	)

	assert.Equal(t, remoteId, remoteBackup.ServerId())

	err = is.Add(remoteBackup)
	require.NoError(t, err)

	assert.False(t, remoteBackup.DbId.IsZero())

	remoteFetch := is.Get(remoteBackup.DbId.Hex())
	require.NotNil(t, remoteFetch)
	assert.Equal(t, remoteId, remoteFetch.ServerId())

	badServer := models.NewInstance(
		"", "", "deadbeefdeadbeef", models.BackupServerRole, false, "", is.GetLocal().ServerId(),
	)
	err = is.Add(badServer)
	assert.ErrorIs(t, err, werror.ErrNoServerName)

	badServer.UsingKey = ""
	badServer.Name = "test server name"
	err = is.Add(badServer)
	assert.ErrorIs(t, err, werror.ErrNoServerKey)

	badServer.UsingKey = "deadbeefdeadbeef"
	badServer.Id = ""
	err = is.Add(badServer)
	assert.ErrorIs(t, err, werror.ErrNoServerId)

	anotherCore := models.NewInstance(
		"", "Another Core", "deadbeefdeadbeef", models.CoreServerRole, false, "", is.GetLocal().ServerId(),
	)
	err = is.Add(anotherCore)
	assert.ErrorIs(t, err, werror.ErrNoCoreAddress)
}

func TestInstanceServiceImpl_InitCore(t *testing.T) {
	t.Parallel()

	col := mondb.Collection(t.Name())
	err := col.Drop(context.Background())
	if err != nil {
		log.ErrTrace(err)
		t.Fatal(err)
	}
	if err = col.Drop(context.Background()); err != nil {
		log.ErrTrace(err)
		t.Fatal(err)
	}
	defer col.Drop(context.Background())

	is, err := NewInstanceService(col)
	require.NoError(t, err)

	if !assert.NotNil(t, is.GetLocal()) {
		t.FailNow()
	}
	assert.Equal(t, models.InitServerRole, is.GetLocal().GetRole())

	err = is.InitCore("My Core Server")
	require.NoError(t, err)

	assert.Equal(t, models.CoreServerRole, is.GetLocal().GetRole())

	if err = col.Drop(context.Background()); err != nil {
		log.ErrTrace(err)
		t.Fatal(err)
	}

	badMongo := &mock.MockFailMongoCol{
		RealCol:    col,
		InsertFail: true,
		FindFail:   false,
		UpdateFail: false,
		DeleteFail: false,
	}

	badIs, err := NewInstanceService(badMongo)
	require.NoError(t, err)

	err = badIs.InitCore("My Core Server")
	assert.Error(t, err)

	assert.Equal(t, models.InitServerRole, badIs.GetLocal().GetRole())
}

func TestInstanceServiceImpl_InitBackup(t *testing.T) {
	t.Parallel()

	coreServices, err := tests.NewWeblensTestInstance(t.Name(), env.Config{
		Role: string(models.CoreServerRole),
	})

	require.NoError(t, err)

	keys, err := coreServices.AccessService.GetKeysByUser(coreServices.UserService.Get("test-username"))
	if err != nil {
		log.ErrTrace(err)
		t.FailNow()
	}
	log.Debug.Println("Key count:", len(keys))

	coreAddress := env.GetProxyAddress(coreServices.Cnf)
	coreApiKey := keys[0].Key

	owner := coreServices.UserService.Get("test-username")
	if owner == nil {
		t.Fatalf("No owner")
	}

	col := mondb.Collection(t.Name())
	err = col.Drop(context.Background())
	if err != nil {
		log.ErrTrace(err)
		t.FailNow()
	}

	if err = col.Drop(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer col.Drop(context.Background())

	is, err := NewInstanceService(col)
	require.NoError(t, err)

	if !assert.NotNil(t, is.GetLocal()) {
		t.FailNow()
	}
	assert.Equal(t, models.InitServerRole, is.GetLocal().GetRole())

	err = is.InitBackup("My backup server", coreAddress, coreApiKey)
	require.NoError(t, err)

	assert.Equal(t, models.BackupServerRole, is.GetLocal().GetRole())
}
