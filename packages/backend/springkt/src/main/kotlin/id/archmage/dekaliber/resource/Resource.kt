package id.archmage.dekaliber.resource

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Index
import jakarta.persistence.Table
import org.hibernate.annotations.CreationTimestamp
import org.hibernate.annotations.UpdateTimestamp
import java.time.Instant
import java.util.UUID

// Entity generik untuk stress-test CRUD (§6 README), setara dengan model
// `Resource` di sisi NestJS/Prisma — tidak merepresentasikan domain bisnis apa pun.
@Entity
@Table(
    name = "resource",
    indexes = [
        Index(name = "idx_resource_status", columnList = "status"),
        Index(name = "idx_resource_created_at", columnList = "createdAt"),
    ],
)
class Resource(
    @Id
    @Column(updatable = false, nullable = false)
    var id: UUID = UUID.randomUUID(),

    var label: String = "",

    var value: Int = 0,

    var status: String = "active",

    @CreationTimestamp
    @Column(updatable = false)
    var createdAt: Instant? = null,

    @UpdateTimestamp
    var updatedAt: Instant? = null,
)
