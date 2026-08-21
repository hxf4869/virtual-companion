# DEPLOY runtime image: JRE 25 + the boot jar from a prior ./mvnw verify.
# Build context is the repo root (compose sets it), so the jar path is stable.
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY service/apps/runtime/target/virtual-companion-runtime-*.jar /app/app.jar
RUN useradd --system vc && chown -R vc:vc /app
USER vc
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
