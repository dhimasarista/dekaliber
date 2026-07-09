package resource

import (
	"time"

	"github.com/google/uuid"
)

// Resource — generic entity for CRUD stress-testing (mirrors the NestJS
// Prisma model and Spring Boot JPA entity). Not a real domain concept;
// deliberately minimal so ORM/serialization overhead doesn't become noise
// when comparing backends.
type Resource struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Label     string    `gorm:"not null" json:"label"`
	Value     int       `gorm:"not null" json:"value"`
	Status    string    `gorm:"not null;default:active;index:idx_resource_fiber_status" json:"status"`
	CreatedAt time.Time `gorm:"not null;index:idx_resource_fiber_created_at" json:"createdAt"`
	UpdatedAt time.Time `gorm:"not null" json:"updatedAt"`
}

func (Resource) TableName() string {
	return "resource_fiber"
}
