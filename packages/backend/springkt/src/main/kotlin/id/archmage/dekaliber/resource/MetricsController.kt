package id.archmage.dekaliber.resource

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.lang.management.ManagementFactory
import java.nio.file.Files
import java.nio.file.Path

private const val MB = 1024.0 * 1024.0

// §7 README: memory backend + GC pause count. Dipakai plain JMX (MemoryMXBean,
// GarbageCollectorMXBean) alih-alih menambah dependency Spring Boot Actuator --
// cukup untuk kebutuhan monitoring load-test ini.
//
// RSS asli: JVM tidak punya API standar lintas-platform untuk ini (beda dengan
// Node yang punya process.memoryUsage().rss). Di Linux (termasuk kontainer
// tempat prod/native image biasanya jalan) kita baca VmRSS langsung dari
// /proc/self/status -- sama presisinya dengan cara Node membaca RSS dari
// kernel. Di OS lain (mis. macOS saat dev) file ini tidak ada, jadi kita
// fallback ke heapUsed dan tandai lewat "rssSource" supaya angkanya tidak
// disalahartikan sebagai RSS asli saat dibandingkan dengan NestJS.
@RestController
class MetricsController {

    private val procStatus: Path = Path.of("/proc/self/status")

    @GetMapping("/metrics")
    fun metrics(): Map<String, Any> {
        val heap = ManagementFactory.getMemoryMXBean().heapMemoryUsage
        val gcBeans = ManagementFactory.getGarbageCollectorMXBeans()
        val (rssMB, rssSource) = readRssMB(heap.used)

        return mapOf(
            "rssMB" to rssMB,
            "rssSource" to rssSource,
            "heapUsedMB" to round2(heap.used / MB),
            "heapCommittedMB" to round2(heap.committed / MB),
            "heapMaxMB" to round2(heap.max / MB),
            "gcCount" to gcBeans.sumOf { it.collectionCount.coerceAtLeast(0) },
            "gcTimeMs" to gcBeans.sumOf { it.collectionTime.coerceAtLeast(0) },
        )
    }

    private fun readRssMB(heapUsedFallback: Long): Pair<Double, String> {
        val vmRssKb = runCatching {
            if (!Files.isReadable(procStatus)) return@runCatching null
            Files.readAllLines(procStatus)
                .firstOrNull { it.startsWith("VmRSS:") }
                ?.let { line -> line.removePrefix("VmRSS:").trim().removeSuffix("kB").trim().toLongOrNull() }
        }.getOrNull()

        return if (vmRssKb != null) {
            round2(vmRssKb * 1024.0 / MB) to "proc"
        } else {
            round2(heapUsedFallback / MB) to "heapFallback"
        }
    }

    private fun round2(value: Double): Double = Math.round(value * 100) / 100.0
}
