package product

import "context"

type ListResult struct {
	Products   []Product
	NextCursor string
}

// Repository is the persistence boundary for products. Handlers depend on this
// interface, not on DynamoDB directly.
type Repository interface {
	Create(ctx context.Context, input CreateInput) (*Product, error)
	Get(ctx context.Context, id string) (*Product, error)
	Update(ctx context.Context, id string, input UpdateInput) (*Product, error)
	Delete(ctx context.Context, id string) error
	ListByCategory(ctx context.Context, category string, limit int32, cursor string) (*ListResult, error)
}
