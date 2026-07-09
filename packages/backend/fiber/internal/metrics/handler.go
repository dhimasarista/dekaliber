package metrics

import (
	"math"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
)

const mb = 1024.0 * 1024.0

// Mirrors the Spring Boot MetricsController: Go, like the JVM, has no
// standard cross-platform API for a process's true RSS. On Linux (including
// containers, where this would actually run in prod) we read VmRSS from
// /proc/self/status — same mechanism as `ps`/`top`, and the same trick the
// Spring Boot side uses. Elsewhere (e.g. macOS during local dev) we fall
// back to runtime.MemStats' heap figures, marked via rssSource so it's never
// silently conflated with a real RSS reading.
func Register(router fiber.Router) {
	router.Get("/metrics", handle)
}

func handle(c fiber.Ctx) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	rssMB, rssSource := readRSS(m.HeapAlloc)

	return c.JSON(fiber.Map{
		"rssMB":          rssMB,
		"rssSource":      rssSource,
		"heapAllocMB":    round2(float64(m.HeapAlloc) / mb),
		"heapSysMB":      round2(float64(m.HeapSys) / mb),
		"gcCount":        m.NumGC,
		"gcPauseTotalMs": round2(float64(m.PauseTotalNs) / 1e6),
	})
}

func readRSS(heapAllocFallback uint64) (float64, string) {
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return round2(float64(heapAllocFallback) / mb), "heapFallback"
	}

	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			break
		}
		kb, parseErr := strconv.ParseFloat(fields[1], 64)
		if parseErr != nil {
			break
		}
		return round2(kb * 1024.0 / mb), "proc"
	}

	return round2(float64(heapAllocFallback) / mb), "heapFallback"
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
