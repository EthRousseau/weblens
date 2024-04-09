package types

import "errors"

type WeblensError error

var ErrAlreadyInitialized WeblensError = errors.New("attempting to run an initialization routine for a second time")
var ErrServerNotInit WeblensError = errors.New("server is not initilized")
