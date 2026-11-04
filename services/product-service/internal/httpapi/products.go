package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/product"
	"github.com/gin-gonic/gin"
)

type ProductHandler struct {
	repo product.Repository
}

func NewProductHandler(repo product.Repository) *ProductHandler {
	return &ProductHandler{repo: repo}
}

type createProductRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SKU         string `json:"sku"`
	Category    string `json:"category"`
	PriceCents  int64  `json:"priceCents"`
	Currency    string `json:"currency"`
}

type updateProductRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Category    *string `json:"category"`
	PriceCents  *int64  `json:"priceCents"`
	Currency    *string `json:"currency"`
	Version     int64   `json:"version"`
}

type listProductsResponse struct {
	Items      []product.Product `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (h *ProductHandler) Create(c *gin.Context) {
	if h.repo == nil {
		writeError(c, http.StatusServiceUnavailable, "storage_unavailable", "product storage is not configured")
		return
	}

	var req createProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "invalid request body")
		return
	}

	input := product.CreateInput{
		Name:        req.Name,
		Description: req.Description,
		SKU:         req.SKU,
		Category:    req.Category,
		PriceCents:  req.PriceCents,
		Currency:    req.Currency,
	}

	if err := input.Normalize(); err != nil {
		writeProductError(c, err)
		return
	}

	created, err := h.repo.Create(c.Request.Context(), input)
	if err != nil {
		writeProductError(c, err)
		return
	}

	c.JSON(http.StatusCreated, created)
}

func (h *ProductHandler) Get(c *gin.Context) {
	if h.repo == nil {
		writeError(c, http.StatusServiceUnavailable, "storage_unavailable", "product storage is not configured")
		return
	}

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "product id is required")
		return
	}

	item, err := h.repo.Get(c.Request.Context(), id)
	if err != nil {
		writeProductError(c, err)
		return
	}

	if item.Status != product.StatusActive {
		writeProductError(c, product.ErrNotFound)
		return
	}

	c.JSON(http.StatusOK, item)
}

func (h *ProductHandler) Update(c *gin.Context) {
	if h.repo == nil {
		writeError(c, http.StatusServiceUnavailable, "storage_unavailable", "product storage is not configured")
		return
	}

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "product id is required")
		return
	}

	var req updateProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "invalid_request", "invalid request body")
		return
	}

	input := product.UpdateInput{
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		PriceCents:  req.PriceCents,
		Currency:    req.Currency,
		Version:     req.Version,
	}

	if err := input.Normalize(); err != nil {
		writeProductError(c, err)
		return
	}

	updated, err := h.repo.Update(c.Request.Context(), id, input)
	if err != nil {
		writeProductError(c, err)
		return
	}

	c.JSON(http.StatusOK, updated)
}

func (h *ProductHandler) Delete(c *gin.Context) {
	if h.repo == nil {
		writeError(c, http.StatusServiceUnavailable, "storage_unavailable", "product storage is not configured")
		return
	}

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "product id is required")
		return
	}

	if err := h.repo.Delete(c.Request.Context(), id); err != nil {
		writeProductError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *ProductHandler) List(c *gin.Context) {
	if h.repo == nil {
		writeError(c, http.StatusServiceUnavailable, "storage_unavailable", "product storage is not configured")
		return
	}

	category := strings.ToLower(strings.TrimSpace(c.Query("category")))
	if category == "" {
		writeError(c, http.StatusBadRequest, "invalid_request", "category is required")
		return
	}

	limit := int32(20)
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(c, http.StatusBadRequest, "invalid_request", "limit must be between 1 and 100")
			return
		}

		limit = int32(parsed)
	}

	cursor := strings.TrimSpace(c.Query("cursor"))

	result, err := h.repo.ListByCategory(c.Request.Context(), category, limit, cursor)
	if err != nil {
		writeProductError(c, err)
		return
	}

	if result.Products == nil {
		result.Products = []product.Product{}
	}

	c.JSON(http.StatusOK, listProductsResponse{
		Items:      result.Products,
		NextCursor: result.NextCursor,
	})
}

func writeProductError(c *gin.Context, err error) {
	var validation product.ValidationError

	switch {
	case errors.As(err, &validation):
		writeError(c, http.StatusBadRequest, "validation_error", validation.Message)
	case errors.Is(err, product.ErrNotFound):
		writeError(c, http.StatusNotFound, "not_found", "product not found")
	case errors.Is(err, product.ErrSKUExists):
		writeError(c, http.StatusConflict, "sku_exists", "sku already exists")
	case errors.Is(err, product.ErrAlreadyExists):
		writeError(c, http.StatusConflict, "already_exists", "product already exists")
	case errors.Is(err, product.ErrVersionConflict):
		writeError(c, http.StatusConflict, "version_conflict", "product was modified; reload and retry")
	case errors.Is(err, product.ErrInvalidCursor):
		writeError(c, http.StatusBadRequest, "invalid_cursor", "invalid pagination cursor")
	default:
		log.Printf("product handler: %v", err)
		writeError(c, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, errorResponse{
		Error: errorBody{
			Code:    code,
			Message: message,
		},
	})
}
