package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/httpapi"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/product"
)

type fakeProductRepository struct {
	createInput product.CreateInput
	createErr   error

	product   *product.Product
	getErr    error
	updateErr error
	deleteErr error

	listResult *product.ListResult
	listErr    error
}

func (f *fakeProductRepository) Create(ctx context.Context, input product.CreateInput) (*product.Product, error) {
	f.createInput = input

	if f.createErr != nil {
		return nil, f.createErr
	}

	if f.product != nil {
		return f.product, nil
	}

	now := time.Now().UTC()
	return &product.Product{
		ID:          "product-1",
		Name:        input.Name,
		Description: input.Description,
		SKU:         input.SKU,
		Category:    input.Category,
		PriceCents:  input.PriceCents,
		Currency:    input.Currency,
		Status:      product.StatusActive,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

func (f *fakeProductRepository) Get(ctx context.Context, id string) (*product.Product, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}

	if f.product == nil {
		return nil, product.ErrNotFound
	}

	return f.product, nil
}

func (f *fakeProductRepository) Update(ctx context.Context, id string, input product.UpdateInput) (*product.Product, error) {
	if f.updateErr != nil {
		return nil, f.updateErr
	}

	if f.product == nil {
		return nil, product.ErrNotFound
	}

	return f.product, nil
}

func (f *fakeProductRepository) Delete(ctx context.Context, id string) error {
	return f.deleteErr
}

func (f *fakeProductRepository) ListByCategory(ctx context.Context, category string, limit int32, cursor string) (*product.ListResult, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}

	if f.listResult == nil {
		return &product.ListResult{}, nil
	}

	return f.listResult, nil
}

func newProductTestRouter(repo product.Repository) http.Handler {
	return httpapi.NewRouter(config.Config{
		Env:         "test",
		ServiceName: "product-service",
		LogLevel:    "error",
		Version:     "test",
	}, repo)
}

func TestCreateProduct(t *testing.T) {
	repo := &fakeProductRepository{}
	router := newProductTestRouter(repo)

	body := `{
		"name": " Mechanical Keyboard ",
		"description": " A keyboard ",
		"sku": " kb-001 ",
		"category": " Electronics ",
		"priceCents": 4999,
		"currency": " eur "
	}`

	req := httptest.NewRequest(http.MethodPost, "/products", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d: %s", http.StatusCreated, rec.Code, rec.Body.String())
	}

	if repo.createInput.SKU != "KB-001" || repo.createInput.Category != "electronics" {
		t.Fatalf("input was not normalized: %#v", repo.createInput)
	}

	var created product.Product
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if created.ID != "product-1" || created.SKU != "KB-001" {
		t.Fatalf("unexpected product: %#v", created)
	}
}

func TestCreateProductValidationError(t *testing.T) {
	repo := &fakeProductRepository{}
	router := newProductTestRouter(repo)

	body := `{"sku":"KB-001","category":"electronics","priceCents":100,"currency":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/products", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, rec.Code, rec.Body.String())
	}
}

func TestGetProductNotFound(t *testing.T) {
	repo := &fakeProductRepository{getErr: product.ErrNotFound}
	router := newProductTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/products/missing", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d: %s", http.StatusNotFound, rec.Code, rec.Body.String())
	}
}

func TestUpdateProductVersionConflict(t *testing.T) {
	repo := &fakeProductRepository{updateErr: product.ErrVersionConflict}
	router := newProductTestRouter(repo)

	body := `{"name":"New name","version":2}`
	req := httptest.NewRequest(http.MethodPut, "/products/product-1", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d: %s", http.StatusConflict, rec.Code, rec.Body.String())
	}
}

func TestListProducts(t *testing.T) {
	repo := &fakeProductRepository{
		listResult: &product.ListResult{
			Products: []product.Product{
				{ID: "product-1", Name: "Keyboard", Status: product.StatusActive},
			},
			NextCursor: "next",
		},
	}
	router := newProductTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/products?category=Electronics&limit=10", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var response struct {
		Items      []product.Product `json:"items"`
		NextCursor string            `json:"nextCursor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(response.Items) != 1 || response.NextCursor != "next" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestDeleteProduct(t *testing.T) {
	repo := &fakeProductRepository{}
	router := newProductTestRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/products/product-1", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d: %s", http.StatusNoContent, rec.Code, rec.Body.String())
	}
}
