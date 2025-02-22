package models_test

import (
	"testing"

	. "github.com/ethanrous/weblens/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var username = "bob"
var password = "b0bz!23"

func TestUserPassword(t *testing.T) {
	t.Parallel()

	u, err := NewUser(Username(username), password, false, false)
	require.NoError(t, err)

	// u.Password is the hash of the password, they should not match
	assert.NotEqual(t, u.Password, password)

	wrongPassCheck := u.CheckLogin("wrongPassword")
	assert.False(t, wrongPassCheck)

	wrongPassCheck2 := u.CheckLogin(password)
	assert.False(t, wrongPassCheck2)

	u.Activated = true
	rightPassCheck := u.CheckLogin(password)
	assert.True(t, rightPassCheck)
}
