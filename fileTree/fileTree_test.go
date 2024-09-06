package fileTree_test

import (
	"os"
	"path/filepath"
	"testing"

	. "github.com/ethrousseau/weblens/fileTree"
	"github.com/ethrousseau/weblens/internal/log"
	"github.com/ethrousseau/weblens/internal/werror"
	"github.com/ethrousseau/weblens/service/mock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileTree(t *testing.T) {
	tree, err := newTestFileTree()
	require.NoError(t, err)

	root := tree.GetRoot()
	rootStat, err := os.Stat(root.GetAbsPath())
	require.NoError(t, err)

	assert.True(t, rootStat.IsDir())

	newDir, err := tree.MkDir(root, "my folder", nil)
	require.NoError(t, err)

	_, err = os.Stat(newDir.GetAbsPath())
	require.NoError(t, err)
	assert.True(t, newDir.IsDir())

	newFile, err := tree.Touch(root, "my file", nil)
	require.NoError(t, err)

	_, err = os.Stat(newFile.GetAbsPath())
	require.NoError(t, err)
	assert.False(t, newFile.IsDir())

	// Given path is not allowed to be created on filesystem, so this call fails
	_, err = NewFileTree("/this/file/cant/be/created", "ALIASNAME", nil, nil)
	assert.Error(t, err)

	// We know the root of the other tree already exists, so we can create a new tree as a child,
	// even if the directory does not exist, the tree will create it.
	newRootPath := filepath.Join(tree.GetRoot().GetAbsPath(), "this_can_be_created_parent", "this_can_be_created")
	_, err = os.Stat(newRootPath)
	assert.Error(t, err)

	_, err = NewFileTree(newRootPath, "ALIASNAME", nil, &mock.HollowJournalService{})
	assert.NoError(t, err)

	_, err = os.Stat(newRootPath)
	assert.NoError(t, err)
}

func TestFileTreeImpl_Move(t *testing.T) {
	tree, err := newTestFileTree()
	require.NoError(t, err)

	root := tree.GetRoot()
	newDir1, err := tree.MkDir(root, "Dir1", nil)
	require.NoError(t, err)

	newDir2, err := tree.MkDir(root, "Dir2", nil)
	require.NoError(t, err)

	newFile, err := tree.MkDir(newDir1, "file", nil)
	require.NoError(t, err)

	_, err = newDir1.GetChild(newFile.Filename())
	assert.NoError(t, err)

	_, err = newDir2.GetChild(newFile.Filename())
	assert.Error(t, err)

	oldPath := newFile.GetAbsPath()

	// Move file from under newDir1 to under newDir2
	moved, err := tree.Move(newFile, newDir2, newFile.Filename(), false, nil)
	require.NoError(t, err)

	assert.NotEqual(t, oldPath, newFile.GetAbsPath())

	assert.Equal(t, 1, len(moved))

	_, err = newDir1.GetChild(newFile.Filename())
	assert.Error(t, err)

	_, err = newDir2.GetChild(newFile.Filename())
	assert.NoError(t, err)

	_, err = os.Stat(newFile.GetAbsPath())
	assert.NoError(t, err)

	// Move newDir2, with newFile inside, all under newDir1
	moved2, err := tree.Move(newDir2, newDir1, newDir2.Filename(), false, nil)
	require.NoError(t, err)

	assert.Equal(t, 2, len(moved2))

	_, err = newDir1.GetChild(newDir2.Filename())
	assert.NoError(t, err)
	_, err = newDir2.GetChild(newFile.Filename())
	assert.NoError(t, err)

	assert.Equal(t, newDir1, newDir2.GetParent())
	assert.Equal(t, newDir2, newFile.GetParent())

	// Create file with the same name as the first
	newFile2, err := tree.Touch(root, "file", nil)
	require.NoError(t, err)

	// Move should fail because we are not allowing overwrite of the previous file with the same name
	_, err = tree.Move(newFile2, newDir2, newFile2.Filename(), false, nil)
	assert.ErrorIs(t, err, werror.ErrFileAlreadyExists)

	// Try again with overwrite enabled, should not fail
	_, err = tree.Move(newFile2, newDir2, newFile2.Filename(), true, nil)
	assert.NoError(t, err)
}

func TestFileTreeImpl_Del(t *testing.T) {
	tree, err := newTestFileTree()
	require.NoError(t, err)

	root := tree.GetRoot()

	_, err = tree.Del(root.ID(), nil)
	assert.Error(t, err)

	newDir, err := tree.MkDir(root, "newDir", nil)
	require.NoError(t, err)

	_, err = os.Stat(newDir.GetAbsPath())
	require.NoError(t, err)

	deleted, err := tree.Del(newDir.ID(), nil)
	assert.NoError(t, err)

	assert.Equal(t, 1, len(deleted))

	_, err = os.Stat(newDir.GetAbsPath())
	assert.Error(t, err)

	newDir2, err := tree.MkDir(root, "newDir2", nil)
	require.NoError(t, err)

	_, err = tree.MkDir(newDir2, "newDir3", nil)
	require.NoError(t, err)

	deleted2, err := tree.Del(newDir2.ID(), nil)
	require.NoError(t, err)

	assert.Equal(t, 2, len(deleted2))
}

func newTestFileTree() (FileTree, error) {
	hasher := mock.NewMockHasher()
	journal := mock.NewHollowJournalService()

	rootPath, err := os.MkdirTemp("", "weblens-test-*")
	if err != nil {
		return nil, err
	}

	// MkdirTemp does not add a trailing slash to directories, which the fileTree expects
	rootPath += "/"

	log.Trace.Printf("Creating tmp root for FileTree test [%s]", rootPath)

	tree, err := NewFileTree(rootPath, "MEDIA", hasher, journal)
	if err != nil {
		return nil, err
	}

	return tree, nil
}
