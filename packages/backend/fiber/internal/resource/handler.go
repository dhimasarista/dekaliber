package resource

import (
	"errors"
	"strconv"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(router fiber.Router) {
	router.Post("/resource", h.create)
	router.Get("/resource", h.findMany)
	router.Get("/resource/:id", h.findOne)
	router.Put("/resource/:id", h.update)
	router.Delete("/resource/:id", h.remove)
}

func (h *Handler) create(c fiber.Ctx) error {
	var req CreateRequest
	if err := c.Bind().JSON(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := req.Validate(); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	r, err := h.svc.Create(req)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(r)
}

func (h *Handler) findMany(c fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize", "20"))
	raw, _ := strconv.ParseBool(c.Query("raw", "false"))

	q := QueryParams{
		Status:   c.Query("status"),
		Sort:     c.Query("sort"),
		Order:    c.Query("order"),
		Page:     page,
		PageSize: pageSize,
		Raw:      raw,
	}

	results, err := h.svc.FindMany(q)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(results)
}

func (h *Handler) findOne(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid id")
	}

	r, err := h.svc.FindOne(id)
	if errors.Is(err, ErrNotFound) {
		return fiber.NewError(fiber.StatusNotFound, err.Error())
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(r)
}

func (h *Handler) update(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid id")
	}

	var req UpdateRequest
	if err := c.Bind().JSON(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if err := req.Validate(); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	r, err := h.svc.Update(id, req)
	if errors.Is(err, ErrNotFound) {
		return fiber.NewError(fiber.StatusNotFound, err.Error())
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(r)
}

func (h *Handler) remove(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid id")
	}

	if err := h.svc.Remove(id); errors.Is(err, ErrNotFound) {
		return fiber.NewError(fiber.StatusNotFound, err.Error())
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.SendStatus(fiber.StatusNoContent)
}
