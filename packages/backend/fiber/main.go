package main

import (
	"flag"
	"log"
	"os"

	"github.com/gofiber/fiber/v3"

	"id.archmage/dekaliber-fiber/internal/db"
	"id.archmage/dekaliber-fiber/internal/metrics"
	"id.archmage/dekaliber-fiber/internal/resource"
)

func main() {
	dbHost := flag.String("db-host", envOr("DB_HOST", "localhost"), "Postgres host")
	dbPort := flag.String("db-port", envOr("DB_PORT", "5432"), "Postgres port")
	dbName := flag.String("db-name", envOr("DB_NAME", "dekaliber"), "Postgres database name")
	dbUsername := flag.String("db-username", envOr("DB_USERNAME", "postgres"), "Postgres username")
	dbPassword := flag.String("db-password", envOr("DB_PASSWORD", ""), "Postgres password")
	serverPort := flag.String("server-port", envOr("FIBER_PORT", "8082"), "HTTP server port")
	flag.Parse()

	conn, err := db.Connect(db.Config{
		Host:     *dbHost,
		Port:     *dbPort,
		Name:     *dbName,
		Username: *dbUsername,
		Password: *dbPassword,
	})
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	if err := conn.AutoMigrate(&resource.Resource{}); err != nil {
		log.Fatalf("failed to migrate schema: %v", err)
	}

	app := fiber.New(fiber.Config{
		AppName: "dekaliber-fiber",
	})

	resource.NewHandler(resource.NewService(conn)).Register(app)
	metrics.Register(app)

	log.Printf("dekaliber-fiber listening on :%s", *serverPort)
	if err := app.Listen(":" + *serverPort); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
