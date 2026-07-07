package id.archmage.dekaliber.resource

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.lang.management.ManagementFactory

private const val MB = 1024.0 * 1024.0

// §7 README: memory backend + GC pause count. Dipakai plain JMX (MemoryMXBean,
// GarbageCollectorMXBean) alih-alih menambah dependency Spring Boot Actuator --
// cukup untuk kebutuhan monitoring load-test ini.
//
// Catatan: JVM tidak punya API standar lintas-platform untuk RSS per-proses
// (beda dengan Node yang punya process.memoryUsage().rss asli). Jadi yang
// dilaporkan di sini adalah heap used/committed/max, BUKAN RSS -- disebutkan
// eksplisit di nama field supaya tidak disalahartikan saat dibandingkan
// dengan angka rssMB dari NestJS.
@RestController
class MetricsController {

    @GetMapping("/metrics")
    fun metrics(): Map<String, Any> {
        val heap = ManagementFactory.getMemoryMXBean().heapMemoryUsage
        val gcBeans = ManagementFactory.getGarbageCollectorMXBeans()

        return mapOf(
            "heapUsedMB" to round2(heap.used / MB),
            "heapCommittedMB" to round2(heap.committed / MB),
            "heapMaxMB" to round2(heap.max / MB),
            "gcCount" to gcBeans.sumOf { it.collectionCount.coerceAtLeast(0) },
            "gcTimeMs" to gcBeans.sumOf { it.collectionTime.coerceAtLeast(0) },
        )
    }

    private fun round2(value: Double): Double = Math.round(value * 100) / 100.0
}
