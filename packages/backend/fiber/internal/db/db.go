package db

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

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
	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
}
