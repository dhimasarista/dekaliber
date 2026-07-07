package id.archmage.dekaliber.resource

import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/resource")
class ResourceController(private val service: ResourceService) {

    @PostMapping
    fun create(@Valid @RequestBody request: CreateResourceRequest): ResponseEntity<ResourceResponse> {
        val created = service.create(request)
        return ResponseEntity.status(HttpStatus.CREATED).body(ResourceResponse.from(created))
    }

    @GetMapping
    fun findMany(
        @RequestParam(required = false) status: String?,
        @RequestParam(required = false) sort: String?,
        @RequestParam(required = false) order: String?,
        @RequestParam(defaultValue = "1") page: Int,
        @RequestParam(defaultValue = "20") pageSize: Int,
        @RequestParam(defaultValue = "false") raw: Boolean,
    ): List<ResourceResponse> =
        service.findMany(status, sort, order, page, pageSize, raw).map(ResourceResponse::from)

    @GetMapping("/{id}")
    fun findOne(@PathVariable id: UUID): ResourceResponse = ResourceResponse.from(service.findOne(id))

    @PutMapping("/{id}")
    fun update(@PathVariable id: UUID, @RequestBody request: UpdateResourceRequest): ResourceResponse =
        ResourceResponse.from(service.update(id, request))

    @DeleteMapping("/{id}")
    fun remove(@PathVariable id: UUID): ResponseEntity<Void> {
        service.remove(id)
        return ResponseEntity.noContent().build()
    }
}
