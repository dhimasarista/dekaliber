package id.archmage.dekaliber.resource

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
import java.time.Instant
import java.util.UUID

data class CreateResourceRequest(
    @field:NotBlank
    val label: String,
    @field:NotNull
    val value: Int,
    val status: String? = null,
)

data class UpdateResourceRequest(
    val label: String? = null,
    val value: Int? = null,
    val status: String? = null,
)

data class ResourceResponse(
    val id: UUID,
    val label: String,
    val value: Int,
    val status: String,
    val createdAt: Instant?,
    val updatedAt: Instant?,
) {
    companion object {
        fun from(resource: Resource) = ResourceResponse(
            id = resource.id,
            label = resource.label,
            value = resource.value,
            status = resource.status,
            createdAt = resource.createdAt,
            updatedAt = resource.updatedAt,
        )
    }
}
