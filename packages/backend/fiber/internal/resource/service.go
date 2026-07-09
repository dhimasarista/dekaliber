package resource

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrNotFound = errors.New("resource not found")

type Service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// create_brutal — POST /resource in a tight loop
func (s *Service) Create(req CreateRequest) (*Resource, error) {
	status := req.Status
	if status == "" {
		status = "active"
	}
	r := &Resource{Label: req.Label, Value: req.Value, Status: status}
	if err := s.db.Create(r).Error; err != nil {
		return nil, err
	}
	return r, nil
}

// read_light — GET /resource/:id, pure routing + serialization overhead
func (s *Service) FindOne(id uuid.UUID) (*Resource, error) {
	var r Resource
	err := s.db.First(&r, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// read_heavy — GET /resource?filter&sort&page, query planner + N+1 risk + connection pool
func (s *Service) FindMany(q QueryParams) ([]Resource, error) {
	page := q.Page
	if page < 1 {
		page = 1
	}
	pageSize := q.PageSize
	if pageSize < 1 {
		pageSize = 20
	}

	if q.Raw {
		return s.findManyRaw(q, page, pageSize)
	}

	var results []Resource
	tx := s.db.Model(&Resource{})
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	tx = tx.Order(fmt.Sprintf("%s %s", q.SortColumn(), q.OrderDirection())).
		Offset((page - 1) * pageSize).
		Limit(pageSize)

	if err := tx.Find(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

// Raw SQL control path (bypasses the ORM query builder) — mirrors the
// equivalent NestJS $queryRaw path used as a query_heavy comparison baseline.
func (s *Service) findManyRaw(q QueryParams, page, pageSize int) ([]Resource, error) {
	var results []Resource
	query := fmt.Sprintf(
		`SELECT * FROM resource_fiber %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		statusFilterClause(q.Status),
		q.SortColumn(),
		q.OrderDirection(),
	)

	args := []any{}
	if q.Status != "" {
		args = append(args, q.Status)
	}
	args = append(args, pageSize, (page-1)*pageSize)

	if err := s.db.Raw(query, args...).Scan(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

func statusFilterClause(status string) string {
	if status == "" {
		return ""
	}
	return "WHERE status = ?"
}

// update_brutal — PUT /resource/:id in a tight loop, row lock contention + index update cost
func (s *Service) Update(id uuid.UUID, req UpdateRequest) (*Resource, error) {
	r, err := s.FindOne(id)
	if err != nil {
		return nil, err
	}
	if req.Label != nil {
		r.Label = *req.Label
	}
	if req.Value != nil {
		r.Value = *req.Value
	}
	if req.Status != nil {
		r.Status = *req.Status
	}
	if err := s.db.Save(r).Error; err != nil {
		return nil, err
	}
	return r, nil
}

// delete_brutal — DELETE /resource/:id in a tight loop
func (s *Service) Remove(id uuid.UUID) error {
	if _, err := s.FindOne(id); err != nil {
		return err
	}
	return s.db.Delete(&Resource{}, "id = ?", id).Error
}
