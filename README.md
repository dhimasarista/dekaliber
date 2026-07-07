# Dekaliber

Dekaliber is a personal, exploratory backend load-testing tool. It compares how two backends — **NestJS** and **Spring Boot (Kotlin)** — hold up under brutal CRUD load (create, read, update, delete, and mixed workloads).

A single [AnalogJS](https://analogjs.org) app plays three roles at once: the trigger form, the load generator (running server-side via a Nitro route, not in the browser), and the live results dashboard. Results are stored locally for personal reference, not as a rigorous, lab-grade benchmark — this is a side project, not a basis for production stack decisions.

The target backend isn't fixed to just those two: you point the generator at any port, and it checks reachability before letting you run.
