package db

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Pinned to match the other backends' explicit pool settings (Spring Boot's
// HikariCP maximum-pool-size, NestJS's pg.Pool max) for apples-to-apples
// load-test comparison -- see _docs/fiber-backend.md. Go's database/sql
// defaults MaxOpenConns to 0 (unlimited) when left unset, which would let
// Fiber open far more concurrent DB connections than the other backends
// under load -- an advantage from an unset default, not from the language
// or driver being faster.
const dbPoolMax = 50

type Config struct {
	Host     string
	Port     string
	Name     string
	Username string
	Password string
}

func Connect(cfg Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s dbname=%s user=%s password=%s sslmode=disable",
		cfg.Host, cfg.Port, cfg.Name, cfg.Username, cfg.Password,
	)
	gdb, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(dbPoolMax)
	sqlDB.SetMaxIdleConns(dbPoolMax)

	return gdb, nil
}
