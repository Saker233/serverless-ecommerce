package product

import (
	"strings"
	"unicode/utf8"
)

type CreateInput struct {
	Name        string
	Description string
	SKU         string
	Category    string
	PriceCents  int64
	Currency    string
}

type UpdateInput struct {
	Name        *string
	Description *string
	Category    *string
	PriceCents  *int64
	Currency    *string
	Version     int64
}

// Normalize trims and canonicalizes create input, then validates it.
func (in *CreateInput) Normalize() error {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	in.SKU = strings.ToUpper(strings.TrimSpace(in.SKU))
	in.Category = strings.ToLower(strings.TrimSpace(in.Category))
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))

	if err := validateName(in.Name); err != nil {
		return err
	}

	if err := validateDescription(in.Description); err != nil {
		return err
	}

	if err := validateSKU(in.SKU); err != nil {
		return err
	}

	if err := validateCategory(in.Category); err != nil {
		return err
	}

	if in.PriceCents <= 0 {
		return invalid("priceCents must be greater than 0")
	}

	if err := validateCurrency(in.Currency); err != nil {
		return err
	}

	return nil
}

// Normalize trims and canonicalizes update input, then validates it.
func (in *UpdateInput) Normalize() error {
	if in.Version <= 0 {
		return invalid("version must be greater than 0")
	}

	hasField := false

	if in.Name != nil {
		hasField = true
		value := strings.TrimSpace(*in.Name)
		if err := validateName(value); err != nil {
			return err
		}
		in.Name = &value
	}

	if in.Description != nil {
		hasField = true
		value := strings.TrimSpace(*in.Description)
		if err := validateDescription(value); err != nil {
			return err
		}
		in.Description = &value
	}

	if in.Category != nil {
		hasField = true
		value := strings.ToLower(strings.TrimSpace(*in.Category))
		if err := validateCategory(value); err != nil {
			return err
		}
		in.Category = &value
	}

	if in.PriceCents != nil {
		hasField = true
		if *in.PriceCents <= 0 {
			return invalid("priceCents must be greater than 0")
		}
	}

	if in.Currency != nil {
		hasField = true
		value := strings.ToUpper(strings.TrimSpace(*in.Currency))
		if err := validateCurrency(value); err != nil {
			return err
		}
		in.Currency = &value
	}

	if !hasField {
		return invalid("at least one field must be provided")
	}

	return nil
}

func validateName(value string) error {
	if value == "" {
		return invalid("name is required")
	}

	if utf8.RuneCountInString(value) > 200 {
		return invalid("name must be at most 200 characters")
	}

	return nil
}

func validateDescription(value string) error {
	if utf8.RuneCountInString(value) > 2000 {
		return invalid("description must be at most 2000 characters")
	}

	return nil
}

func validateSKU(value string) error {
	if value == "" {
		return invalid("sku is required")
	}

	if len(value) > 64 {
		return invalid("sku must be at most 64 characters")
	}

	for _, r := range value {
		if (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			return invalid("sku may contain only A-Z, 0-9, hyphen, and underscore")
		}
	}

	return nil
}

func validateCategory(value string) error {
	if value == "" {
		return invalid("category is required")
	}

	if len(value) > 64 {
		return invalid("category must be at most 64 characters")
	}

	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
			return invalid("category may contain only a-z, 0-9, and hyphen")
		}
	}

	return nil
}

func validateCurrency(value string) error {
	if len(value) != 3 {
		return invalid("currency must be a 3-letter ISO code")
	}

	for _, r := range value {
		if r < 'A' || r > 'Z' {
			return invalid("currency must be a 3-letter ISO code")
		}
	}

	return nil
}
