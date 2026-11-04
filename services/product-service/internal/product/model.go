package product

import "time"

// Status represents the lifecycle state of a product.
type Status string

const (
	StatusActive   Status = "ACTIVE"
	StatusArchived Status = "ARCHIVED"
)

// Product is the public product representation. DynamoDB keys are not exposed
// in API responses.
type Product struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	SKU         string    `json:"sku"`
	Category    string    `json:"category"`
	PriceCents  int64     `json:"priceCents"`
	Currency    string    `json:"currency"`
	Status      Status    `json:"status"`
	Version     int64     `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
