package product

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound        = errors.New("product not found")
	ErrAlreadyExists   = errors.New("product already exists")
	ErrSKUExists       = errors.New("sku already exists")
	ErrVersionConflict = errors.New("product version conflict")
	ErrInvalidCursor   = errors.New("invalid pagination cursor")
)

// ValidationError describes a request that is syntactically valid JSON but
// violates product rules.
type ValidationError struct {
	Message string
}

func (e ValidationError) Error() string {
	return e.Message
}

func invalid(format string, args ...any) error {
	return ValidationError{Message: fmt.Sprintf(format, args...)}
}
