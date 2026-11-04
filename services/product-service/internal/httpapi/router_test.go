package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/httpapi"
)

func newTestRouter() http.Handler {
	return httpapi.NewRouter(config.Config{
		Env:         "test",
		ServiceName: "product-service",
		LogLevel:    "error",
		Version:     "test",
	}, nil)
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)

	newTestRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}

	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected Cache-Control no-store, got %q", got)
	}

	var body httpapi.HealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}

	if body.Status != "ok" {
		t.Fatalf("expected status ok, got %q", body.Status)
	}

	if body.Service != "product-service" {
		t.Fatalf("expected service product-service, got %q", body.Service)
	}

	if body.Version != "test" {
		t.Fatalf("expected version test, got %q", body.Version)
	}

	if body.Environment != "test" {
		t.Fatalf("expected environment test, got %q", body.Environment)
	}

	if _, err := time.Parse(time.RFC3339, body.Time); err != nil {
		t.Fatalf("expected RFC3339 time, got %q: %v", body.Time, err)
	}
}

func TestHealthEchoesCorrelationID(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Correlation-Id", "test-correlation-id")

	newTestRouter().ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Correlation-Id"); got != "test-correlation-id" {
		t.Fatalf("expected correlation ID to be echoed, got %q", got)
	}
}

func TestUnknownRoute(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/does-not-exist", nil)

	newTestRouter().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, rec.Code)
	}

	if got := rec.Header().Get("X-Correlation-Id"); got == "" {
		t.Fatal("expected a generated correlation ID")
	}
}
