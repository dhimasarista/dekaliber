import org.gradle.api.artifacts.transform.InputArtifact
import org.gradle.api.artifacts.transform.TransformAction
import org.gradle.api.artifacts.transform.TransformOutputs
import org.gradle.api.artifacts.transform.TransformParameters
import org.gradle.api.file.FileSystemLocation
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

plugins {
	kotlin("jvm") version "2.3.21"
	kotlin("plugin.spring") version "2.3.21"
	id("org.springframework.boot") version "4.1.0"
	id("io.spring.dependency-management") version "1.1.7"
	id("org.graalvm.buildtools.native") version "1.1.3"
}

group = "id.archmage"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(25)
	}
}

repositories {
	mavenCentral()
}

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	implementation("org.springframework.boot:spring-boot-starter-validation")
	implementation("org.postgresql:postgresql")
	implementation("tools.jackson.module:jackson-module-kotlin")
	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

// Hibernate's BytecodeProviderInitiator ignores the `hibernate.bytecode.provider`
// config property entirely -- it unconditionally ServiceLoader::loads every
// registered org.hibernate.bytecode.spi.BytecodeProvider and only falls back to
// the no-op provider when *zero* are found (see hibernate-core's
// BytecodeProviderInitiator.getBytecodeProvider). The ByteBuddy-backed provider's
// constructor triggers runtime class generation (ClassLoader.defineClass), which
// native-image's closed-world model rejects outright. Since this app's Resource
// entity needs no lazy-loading/enhancement, the only real fix is stripping
// hibernate-core's service registration file for it from every classpath
// (bootJar, runtime, and nativeCompile's exploded classpath all consume the
// same jar via this artifact transform), forcing the ServiceLoader lookup to
// come up empty so Hibernate falls back to its built-in no-op provider.
abstract class StripHibernateBytecodeServiceTransform : TransformAction<TransformParameters.None> {
	@get:InputArtifact
	abstract val inputArtifact: Provider<FileSystemLocation>

	override fun transform(outputs: TransformOutputs) {
		val input = inputArtifact.get().asFile
		if (!input.name.startsWith("hibernate-core-")) {
			outputs.file(input)
			return
		}
		val output = outputs.file(input.name)
		ZipInputStream(input.inputStream()).use { zin: ZipInputStream ->
			ZipOutputStream(output.outputStream()).use { zout: ZipOutputStream ->
				var entry: ZipEntry? = zin.nextEntry
				while (entry != null) {
					if (entry.name != "META-INF/services/org.hibernate.bytecode.spi.BytecodeProvider") {
						zout.putNextEntry(ZipEntry(entry.name))
						zin.copyTo(zout)
						zout.closeEntry()
					}
					entry = zin.nextEntry
				}
			}
		}
	}
}

val artifactType = Attribute.of("artifactType", String::class.java)
val strippedJar = Attribute.of("strippedBytecodeService", Boolean::class.javaObjectType)

dependencies {
	attributesSchema {
		attribute(strippedJar)
	}
	artifactTypes.getByName("jar") {
		attributes.attribute(strippedJar, false)
	}
	registerTransform(StripHibernateBytecodeServiceTransform::class) {
		from.attribute(artifactType, "jar").attribute(strippedJar, false)
		to.attribute(artifactType, "jar").attribute(strippedJar, true)
	}
}

configurations.matching { it.name.startsWith("runtimeClasspath") || it.name.startsWith("nativeImageClasspath") }.configureEach {
	attributes.attribute(strippedJar, true)
}

graalvmNative {
	// The reachability-metadata repository rejects this GraalVM release
	// (25.0.1, very recent LTS) on a schema-compatibility check, and pinning
	// an explicit version fails to download. Disabled here; reflection/resource
	// hints are instead captured by running the app under the native-image
	// tracing agent (`./gradlew -Pagent bootRun`, exercise all endpoints, then
	// `./gradlew metadataCopy --task=bootRun --dir=src/main/resources/META-INF/native-image/id.archmage/dekaliber`)
	// and committed as reachability-metadata.json. Re-run this whenever new
	// endpoints/entities are added -- Hibernate ORM 7's model system builds
	// annotation-mock classes (org.hibernate.boot.models.annotations.internal.*)
	// reflectively per JPA/Hibernate annotation actually used, so coverage is
	// tied to which code paths were exercised while the agent was attached.
	metadataRepository {
		enabled = false
	}
	agent {
        defaultMode = "standard"
    }
}

tasks.withType<Test> {
	useJUnitPlatform()
}

// Spring AOT processing regenerates META-INF/native-image/id.archmage/dekaliber/
// reachability-metadata.json under build/generated/aotResources; bootJar's default
// resource-merging then sees two copies of that path (ours in src/main/resources,
// Spring's generated one) and refuses to guess which wins. Ours already contains
// everything Spring's AOT hints would add (captured by the tracing agent, which
// observes the exact same JPA/web reflection Spring's AOT step would infer), so
// keep the committed one.
tasks.withType<Jar> {
	duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
