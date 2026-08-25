package com.virtualcompanion.runtime;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@ConfigurationPropertiesScan
public class VirtualCompanionRuntimeApplication {

    public static void main(String[] args) {
        SpringApplication.run(VirtualCompanionRuntimeApplication.class, args);
    }
}
