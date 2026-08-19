package com.virtualcompanion.runtime.memory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Deterministic hash embedder (EMBED-RECALL, Technical Alpha).
 *
 * <p>A bag-of-features vector over character-bigram and whitespace-token
 * features, hashed into a fixed 64-dimension space and L2-normalized — same
 * text always yields the same vector, similar texts share features, and no
 * provider or network is involved (本地确定性实现；真实 embedding 供应商以后
 * 替换实现，不改调用方). This is a recall-quality floor, not semantic
 * understanding: the structured recency recall stays the other half of the
 * merge (§11.13).
 */
public final class DeterministicEmbedder implements EmbeddingPort {

    private static final EmbeddingSpace SPACE =
            new EmbeddingSpace("deterministic-hash", "1", 64, "alpha-hash-64");

    @Override
    public EmbeddingSpace space() {
        return SPACE;
    }

    @Override
    public float[] embed(String text) {
        Objects.requireNonNull(text, "text must not be null");
        Map<Integer, Integer> counts = new HashMap<>();
        for (String feature : features(text)) {
            counts.merge(hash(feature), 1, Integer::sum);
        }
        double[] raw = new double[SPACE.dimension()];
        counts.forEach((bucket, count) -> raw[bucket] += count);
        double norm = 0.0;
        for (double v : raw) {
            norm += v * v;
        }
        norm = Math.sqrt(norm);
        float[] vector = new float[SPACE.dimension()];
        for (int i = 0; i < vector.length; i++) {
            vector[i] = norm == 0.0 ? 0f : (float) (raw[i] / norm);
        }
        return vector;
    }

    private static List<String> features(String text) {
        String normalized = text.toLowerCase(Locale.ROOT).trim();
        List<String> out = new ArrayList<>();
        StringBuilder token = new StringBuilder();
        for (int i = 0; i <= normalized.length(); i++) {
            char c = i < normalized.length() ? normalized.charAt(i) : ' ';
            if (Character.isLetterOrDigit(c)) {
                token.append(c);
            } else if (token.length() > 0) {
                addTokenFeatures(out, token.toString());
                token.setLength(0);
            }
        }
        return out;
    }

    private static void addTokenFeatures(List<String> out, String token) {
        if (token.length() == 1) {
            out.add("w:" + token);
            return;
        }
        for (int i = 0; i + 1 < token.length(); i++) {
            out.add("b:" + token.substring(i, i + 2));
        }
        if (token.length() <= 8) {
            out.add("w:" + token);
        }
    }

    private static int hash(String feature) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(feature.getBytes(StandardCharsets.UTF_8));
            int value = ((bytes[0] & 0xFF) << 24) | ((bytes[1] & 0xFF) << 16)
                    | ((bytes[2] & 0xFF) << 8) | (bytes[3] & 0xFF);
            return Math.floorMod(value, SPACE.dimension());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Format a vector as the pgvector text literal (e.g. "[0.25,0.0,...]"). */
    public static String toVectorLiteral(float[] vector) {
        Objects.requireNonNull(vector, "vector must not be null");
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(vector[i]);
        }
        return sb.append(']').toString();
    }
}
