package id.archmage.dekaliber.resource

import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.data.jpa.domain.Specification
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import org.springframework.http.HttpStatus
import java.util.UUID

@Service
class ResourceService(
    private val repository: ResourceRepository,
    private val jdbcTemplate: JdbcTemplate,
) {
    // create_brutal — POST /resource beruntun
    fun create(request: CreateResourceRequest): Resource {
        val resource = Resource(
            label = request.label,
            value = request.value,
            status = request.status ?: "active",
        )
        return repository.save(resource)
    }

    // read_light — GET /resource/:id, overhead routing + serialization murni
    fun findOne(id: UUID): Resource =
        repository.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "Resource $id not found")
        }

    // read_heavy — GET /resource?filter&sort&page, query planner + N+1 risk + connection pool
    fun findMany(
        status: String?,
        sort: String?,
        order: String?,
        page: Int,
        pageSize: Int,
        raw: Boolean,
    ): List<Resource> {
        if (raw) {
            return findManyRaw(status, sort, order, page, pageSize)
        }

        val sortColumn = sort ?: "createdAt"
        val direction = if (order == "asc") Sort.Direction.ASC else Sort.Direction.DESC
        val pageable = PageRequest.of(page - 1, pageSize, Sort.by(direction, sortColumn))

        val spec = Specification<Resource> { root, _, cb ->
            if (status != null) cb.equal(root.get<String>("status"), status) else null
        }

        return repository.findAll(spec, pageable).content
    }

    // Versi raw SQL kontrol (bypass ORM/Hibernate) — wajib per §6, pembanding read_heavy
    private fun findManyRaw(
        status: String?,
        sort: String?,
        order: String?,
        page: Int,
        pageSize: Int,
    ): List<Resource> {
        val columnMap = mapOf(
            "label" to "label",
            "value" to "value",
            "createdAt" to "created_at",
            "updatedAt" to "updated_at",
        )
        val sortColumn = columnMap[sort] ?: "created_at"
        val direction = if (order == "asc") "ASC" else "DESC"

        val where = if (status != null) "WHERE status = ?" else ""
        val sql = """
            SELECT id, label, value, status, created_at, updated_at
            FROM resource
            $where
            ORDER BY $sortColumn $direction
            LIMIT ? OFFSET ?
        """.trimIndent()

        val rowMapper = RowMapper { rs, _ ->
            Resource(
                id = UUID.fromString(rs.getString("id")),
                label = rs.getString("label"),
                value = rs.getInt("value"),
                status = rs.getString("status"),
                createdAt = rs.getTimestamp("created_at")?.toInstant(),
                updatedAt = rs.getTimestamp("updated_at")?.toInstant(),
            )
        }

        return if (status != null) {
            jdbcTemplate.query(sql, rowMapper, status, pageSize, (page - 1) * pageSize)
        } else {
            jdbcTemplate.query(sql, rowMapper, pageSize, (page - 1) * pageSize)
        }
    }

    // update_brutal — PUT /resource/:id beruntun, row lock contention + index update cost
    fun update(id: UUID, request: UpdateResourceRequest): Resource {
        val resource = findOne(id)
        request.label?.let { resource.label = it }
        request.value?.let { resource.value = it }
        request.status?.let { resource.status = it }
        return repository.save(resource)
    }

    // delete_brutal — DELETE /resource/:id beruntun
    fun remove(id: UUID) {
        val resource = findOne(id)
        repository.delete(resource)
    }
}
