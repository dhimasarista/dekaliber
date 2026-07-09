package resource

import (
	"errors"
	"strings"
)

type CreateRequest struct {
	Label  string `json:"label"`
	Value  int    `json:"value"`
	Status string `json:"status"`
}

func (r CreateRequest) Validate() error {
	if strings.TrimSpace(r.Label) == "" {
		return errors.New("label must not be empty")
	}
	if r.Status != "" && r.Status != "active" && r.Status != "inactive" {
		return errors.New("status must be one of: active, inactive")
	}
	return nil
}

type UpdateRequest struct {
	Label  *string `json:"label"`
	Value  *int    `json:"value"`
	Status *string `json:"status"`
}

func (r UpdateRequest) Validate() error {
	if r.Status != nil && *r.Status != "active" && *r.Status != "inactive" {
		return errors.New("status must be one of: active, inactive")
	}
	return nil
}

type QueryParams struct {
	Status   string
	Sort     string
	Order    string
	Page     int
	PageSize int
	Raw      bool
}

var sortColumns = map[string]string{
	"label":     "label",
	"value":     "value",
	"createdAt": "created_at",
	"updatedAt": "updated_at",
}

func (q QueryParams) SortColumn() string {
	if col, ok := sortColumns[q.Sort]; ok {
		return col
	}
	return "created_at"
}

func (q QueryParams) OrderDirection() string {
	if q.Order == "asc" {
		return "ASC"
	}
	return "DESC"
}
