package com.virtualcompanion.runtime.safety;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * DOGFOOD-STABILIZATION-02 audit (ADR-0006 §4.3): a real local sensitive-data
 * detector for the unverified-provider-terms egress gate. The deterministic
 * safety classifier flags grief/crisis/credential hard rules — it does NOT
 * recognize ordinary personal data, so it must never be presented as a PII
 * check. While the moderation provider's terms are unverified, text matching
 * any pattern below must not leave the host.
 *
 * <p>Detected categories (fixed strings, stable order):
 * {@code EMAIL}, {@code MOBILE}, {@code RESIDENT_ID}, {@code BANK_CARD},
 * {@code ADDRESS}, {@code SECRET}, {@code OTP}. Digit-shaped categories
 * (mobile / resident id / bank card) are matched on a copy with common
 * digit separators removed, so spaced-out forms ("138 0013 8000") are still
 * caught; the checksum-validated patterns keep ordinary long numbers (order
 * ids, timestamps) out of the results.</p>
 *
 * <p>The detector only ever returns category names — matched content never
 * reaches logs, alerts or exception messages.</p>
 */
public final class SensitiveDataDetector {

    /** Digit separators folded away before the digit-shaped patterns run. */
    private static final Pattern DIGIT_SEPARATORS =
            Pattern.compile("[\\s\\u00a0,.\\uFF0C\\u00B7()\\-−_/（）]");

    /**
     * China country code dropped from the folded copy before mobile matching
     * (05: 0086 joins +86 — NFKC folds the Arabic-Indic digit spellings of
     * both the code and the number to ASCII already).
     */
    private static final Pattern CN_COUNTRY_CODE =
            Pattern.compile("(?<![0-9])(?:00|\\+)?86(?=1[3-9])");

    private static final Pattern EMAIL =
            Pattern.compile("(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\\.[A-Za-z]{2,}(?![A-Za-z0-9])");

    private static final Pattern CN_MOBILE =
            Pattern.compile("(?<!\\d)1[3-9]\\d{9}(?!\\d)");

    private static final Pattern RESIDENT_ID =
            Pattern.compile("(?<![0-9Xx])\\d{17}[0-9Xx](?![0-9Xx])");

    private static final Pattern BANK_CARD =
            Pattern.compile("(?<!\\d)\\d{13,19}(?!\\d)");

    /**
     * Address heuristic (04-round false-positive fix): every alternative now
     * REQUIRES a house/building NUMBER — a division token followed by a road
     * name plus number, a division token followed by a numbered building/unit,
     * or a road name plus number. Number-free prose like "这个市区道路很宽"
     * (the 03-round false positive: lazy span from 市区 reached the 路 of
     * 道路) can no longer match. City names alone ("我在上海市上班") remain
     * deliberately NOT addresses.
     */
    private static final Pattern ADDRESS =
            Pattern.compile("(?:省|自治区|市|区|县|旗)[\\u4e00-\\u9fa5A-Za-z0-9]{0,20}?(?:路|街|巷|大道)\\s*\\d{1,5}\\s*(?:号|栋|幢)"
                    + "|(?:省|自治区|市|区|县|旗)[\\u4e00-\\u9fa5A-Za-z0-9]{0,20}?\\d{1,5}\\s*(?:号楼|栋|幢|单元|室)"
                    + "|[\\u4e00-\\u9fa5]{2,15}(?:路|街|巷|大道)\\s*\\d{1,5}\\s*(?:号|栋|幢|号楼)");

    /**
     * 07: an administrative suffix only counts as a LEVEL when it is not the
     * tail of a generic compound word — 市 preceded by 城/都 (城市/都市) and
     * 区 preceded by 城/地/市 (城区/地区/市区… 城市/区域 tails) are ordinary
     * nouns, not divisions. Real addresses keep their suffixes: 上海市's 市
     * is preceded by 京, 海淀区's 区 by 淀.
     */
    private static final String ADMIN_SUFFIX =
            "(?:(?<!城)(?<!都)市|(?<!城)(?<!地)(?<!市)区|省|县|镇|村)";

    /** The second level may also be a street/building suffix. */
    private static final String ADMIN_OR_DETAIL_SUFFIX =
            "(?:(?<!城)(?<!都)市|(?<!城)(?<!地)(?<!市)区|省|县|镇|村|街|路|大道|巷|号楼|栋|幢|单元|室)";

    /** 08: address-disclosure keywords; the delivery verbs moved into the relation. */
    private static final String ADDRESS_KEYWORD =
            "(?:我家地址|我家住址|家庭住址|住址|收货地址|收件地址|邮寄地址|寄送地址|送货地址|详细地址|我的地址)";

    /**
     * 08/09: the disclosure RELATION required between an address keyword and
     * the first administrative level — an assignment (是/为/:/：/=), a fill
     * or write verb (填/写到), a location verb (在/位于/住在/搬到), a change
     * verb (改成/改为) or a delivery verb (寄到/寄往/送到/发到/发往…). A
     * settings-UI sentence carries the keyword but a SELECTION verb instead:
     * "我的地址选择北京市后设置海淀区偏好" and "收货地址可以选择北京市或者
     * 天津市" hold two real divisions behind 选择 — a capability
     * description, not a disclosure — so the keyword alone may never reach
     * the levels.
     *
     * <p>09: 在 and the change verbs joined because "我家地址在北京市海淀
     * 区中关村大街" and "收货地址改成北京市海淀区中关村大街" are disclosures
     * even without 是/为 — the relation grammar stays finite and testable.</p>
     */
    private static final String ADDRESS_RELATION =
            "(?:是|为|[:：=]|在|改成|改为|填|位于|住在|寄到|寄至|寄往|送到|送至|发到|发至|发往|搬到|搬至|写到|写至)";

    /**
     * 05: an EXPLICIT address-disclosure context (home/shipping/mailing
     * address) blocks even a house-number-free address — "我家地址是北京市
     * 海淀区中关村大街" is a real disclosure.
     *
     * <p>06/07: the suffix branch requires TWO distinct administrative
     * levels after the keyword (the second may also be a street/building
     * suffix), separated by at least one hanzi. 07 tightens it against
     * stitched settings phrases: generic compound tails (城市/地区/城区/
     * 市区) no longer count as levels ({@link #ADMIN_SUFFIX}), and the gap
     * between the two levels shrank to {0,12} — real divisions sit close
     * together, while a phrase that merely carries two suffix-shaped words
     * ("我的地址选择城市功能并支持地区筛选") cannot span them into a
     * disclosure. A single suffix in ordinary prose ("我的地址选择城市")
     * stays a settings phrase, and location prose ("我在上海市上班")
     * carries none of these keywords.</p>
     *
     * <p>08: a disclosure must also carry an {@link #ADDRESS_RELATION}
     * between the keyword and the first level — two real divisions behind a
     * selection verb are a settings description. The delivery verbs became
     * relations, so they follow a noun keyword ("收货地址寄到北京市…")
     * instead of opening the context on their own.</p>
     *
     * <p>09: a form-value shape without any verb — the keyword, whitespace,
     * then the address itself ("家庭住址 北京市海淀区中关村大街") — is an
     * assignment too, so the relation has a pure-whitespace branch where the
     * first level follows the separator DIRECTLY (a settings sentence behind
     * a selection verb still needs a real relation and stays clean).</p>
     */
    private static final Pattern ADDRESS_CONTEXT = Pattern.compile(
            ADDRESS_KEYWORD
                    + "(?:[^。;；，,]{0,6}?" + ADDRESS_RELATION + "[^。;；，,]{0,4}?"
                    + "|\\s{1,})"
                    + "[\\u4e00-\\u9fa5]{2,}" + ADMIN_SUFFIX
                    + "[^。;；，,]{0,12}[\\u4e00-\\u9fa5]{1,}" + ADMIN_OR_DETAIL_SUFFIX);

    /** Secret keyword reused by the three separator shapes below. */
    private static final String SECRET_KEYWORD =
            "(?i)(密码|口令|密钥|passw(?:or)?d|pwd|api[_\\s-]?key|access[_\\s-]?key|secret|token)";

    /**
     * 07: an assigned secret value is BOUNDED — it runs from the assignment
     * word to the first sentence boundary (，。；！？,;:： newline) or the end
     * of the text. The 06 unbounded lookahead counted prose past a comma:
     * "密码是忘记了，请帮我重置" gathered its 8 chars from the NEXT clause
     * and false-positived. A disclosure lives inside ONE clause.
     */
    private static final Pattern SECRET_VALUE_BOUNDARY =
            Pattern.compile("[，。；！？,;:：\\n]");

    /**
     * 07: SECRET matching is two-step. These patterns locate the assignment
     * START (keyword + 是/为/:/：/=, or keyword + the copula is/are); the
     * value judgment then runs on the bounded clause in
     * {@link #secretPresent(String)} — a single regex cannot express "the
     * value ends at the next punctuation".
     */
    private static final Pattern SECRET_CJK_ASSIGNMENT =
            Pattern.compile(SECRET_KEYWORD + "\\s*(?:是|为|[:：=])\\s*");

    private static final Pattern SECRET_ENGLISH_ASSIGNMENT =
            Pattern.compile(SECRET_KEYWORD + "\\s+(?:is|are)\\s+");

    /**
     * 08/09: the FINITE vocabulary of CJK state/help PHRASES an assigned
     * value may be built from. 08 used it as a lookingAt PREFIX veto, which
     * "密码是请记住abcdefgh" abused — the single word 请 excused everything
     * behind it. 09 consumes these phrases left to right: the value is a
     * state description only while it consists ENTIRELY of them; the first
     * non-vocabulary stretch is the residue, judged by the shared value
     * rule (a digit-carrying token or ≥8 non-space chars). Alternatives are
     * ordered longest-first inside each family so the consumption cannot
     * stop mid-phrase; 请/需要 stay single consumable phrases but can never
     * excuse a later value-shaped residue. No blocked-matrix value is
     * entirely vocabulary, so the gate cannot open a hole in the accepted
     * disclosures.
     */
    private static final Pattern CJK_STATUS_PHRASE = Pattern.compile(
            "忘记了|忘记|忘了|不记得|记不住|记不清"
                    + "|错误的|错误|错了|有误|不对|不正确"
                    + "|太短了|太短|太长了|太长|太简单"
                    + "|复杂度不足|复杂度|不足"
                    + "|失效|过期|被锁|锁定"
                    + "|需要重新设置|需要重设|需要|要重|想重|要改|想改|要换|想换"
                    + "|重新|重置|重设|设置|修改|更换|改成|改为"
                    + "|请帮我|请|帮我|无法使用|无法|不能|没法"
                    + "|丢失|丢了|泄露|被盗");

    /**
     * 08/09: the FINITE grammar vocabulary of an English assigned value —
     * status/configuration terms ("forgotten", "invalid", "reset",
     * "rotation", "policy"…), their verb forms, the aspect/negation adverbs
     * such clauses open with ("is being reset", "is not working"), and the
     * small set of connectors a state sentence needs between them ("and",
     * "to" — "password is reset to abcdefgh" must judge the value after
     * "to"). A value is a state/configuration description ONLY while it
     * consists ENTIRELY of these words; the FIRST token outside the
     * vocabulary starts the actual value, which is then judged by the
     * shared rule. The 08 first-token veto let "password is currently
     * abcdefgh" through — an adverb may introduce a value, never excuse it.
     * Value-shaped words stay out, and "correct" in particular is NOT a
     * member — "correct horse battery staple" is the canonical passphrase
     * disclosure and must keep blocking.
     */
    private static final Set<String> ENGLISH_STATUS_WORDS = Set.of(
            "forgotten", "incorrect", "wrong", "invalid", "expired", "expires",
            "expiring", "locked", "disabled", "missing", "needed", "needs",
            "required", "unknown", "compromised", "leaked", "reset", "changed",
            "updated", "rejected", "short", "long",
            "management", "rotation", "rotate", "rotates", "rotated",
            "rotating", "configuration", "config", "configured", "configuring",
            "policy", "budget", "performance", "setting", "settings",
            "stored", "managed", "generated", "encrypted",
            "being", "not", "no", "already", "currently", "still", "never",
            "always", "too", "again", "now", "set",
            "and", "or", "but", "to", "for", "please", "help");

    /**
     * 06: WITHOUT an assignment word (a bare space after the keyword) only
     * a single ≥3-char digit-carrying token blocks ("我的密码 hunter2secret").
     * The old bare \S{9,} length branch is gone — a merely long following
     * word ("password management", "token performance", "API key
     * configuration", "password forgotten") is ordinary prose, not a
     * disclosure.
     */
    private static final String SECRET_BARE_VALUE =
            "(?=[^\\s]*\\d)(?=\\S{3})";

    private static final Pattern SECRET_BARE_SPACE =
            Pattern.compile(SECRET_KEYWORD + "\\s+" + SECRET_BARE_VALUE);

    /**
     * 04: explicit credential shapes are judged by shape alone — no keyword
     * or value judgment needed.
     */
    private static final Pattern SECRET_CREDENTIAL = Pattern.compile(
            "sk-[A-Za-z0-9]{16,}"
                    + "|AKIA[0-9A-Z]{16}"
                    + "|ghp_[A-Za-z0-9]{20,}"
                    + "|xox[bpars]-[A-Za-z0-9-]{10,}"
                    + "|eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.");

    /** Verification code keyword followed (loosely) by a 3-8 digit value. */
    private static final Pattern OTP =
            Pattern.compile("(?i)(验证码|校验码|动态码|otp|verification[\\s_-]?code)\\s*(?:是|为|[:：=])?\\s*\\d{3,8}");

    /** GB 11643 resident-id check-char table indexed by (sum % 11). */
    private static final char[] RESIDENT_ID_CHECK = "10X98765432".toCharArray();

    /** GB 11643 positional weights for the first 17 digits. */
    private static final int[] RESIDENT_ID_WEIGHTS = {
            7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};

    /** Detected categories in fixed reporting order. */
    public static final List<String> CATEGORIES = List.of(
            "EMAIL", "MOBILE", "RESIDENT_ID", "BANK_CARD", "ADDRESS", "SECRET", "OTP");

    /** @return the matched categories (fixed order, no content), possibly empty. */
    public List<String> detect(String text) {
        if (text == null || text.isBlank()) {
            return List.of();
        }
        // 04/05/06-round normalization, in fixed order NFKC → strip Cf →
        // fold Nd: NFKC folds full-width digits/letters and lookalikes to
        // ASCII; the Cf pass then strips EVERY format code point (LRM/RLM/
        // RLI, zero-widths, soft hyphen…); the Nd-category pass folds every
        // other script's decimal digits (Arabic-Indic ١٣٨…, the
        // supplementary-plane blocks) to ASCII by CODE POINT — obfuscation
        // must not decide whether personal data leaves the host.
        String normalized = normalizeDecimalDigits(
                stripFormatCharacters(Normalizer.normalize(text, Normalizer.Form.NFKC)));
        Set<String> hits = new LinkedHashSet<>();
        if (EMAIL.matcher(normalized).find()) {
            hits.add("EMAIL");
        }
        // Digit-shaped categories run on the separator-folded copy; the
        // mobile pattern also drops a China country code so "+86 138…"
        // spellings carry the same number.
        String compact = DIGIT_SEPARATORS.matcher(normalized).replaceAll("");
        if (CN_MOBILE.matcher(CN_COUNTRY_CODE.matcher(compact).replaceAll("")).find()) {
            hits.add("MOBILE");
        }
        if (validResidentIdPresent(compact)) {
            hits.add("RESIDENT_ID");
        }
        if (validBankCardPresent(compact)) {
            hits.add("BANK_CARD");
        }
        if (ADDRESS.matcher(normalized).find()
                || ADDRESS_CONTEXT.matcher(normalized).find()) {
            hits.add("ADDRESS");
        }
        if (secretPresent(normalized)) {
            hits.add("SECRET");
        }
        if (OTP.matcher(compact).find()) {
            hits.add("OTP");
        }
        List<String> ordered = new ArrayList<>();
        for (String category : CATEGORIES) {
            if (hits.contains(category)) {
                ordered.add(category);
            }
        }
        return ordered;
    }

    /**
     * 07/08/09: the SECRET judgment, shape by shape. Credential shapes match
     * anywhere; a CJK/symbol assignment (是/为/:/：/=) and an English is/are
     * assignment both hand their BOUNDED value to a shared judgment — a
     * first token of ≥3 chars carrying a digit, or a value of ≥8 non-space
     * chars — behind a state-description grammar: the CJK and English
     * shapes each consume their FINITE status/grammar vocabulary from the
     * left, and only the RESIDUE after the last consumed word is judged
     * (09). A value made entirely of grammar words is a state/help
     * description; a grammar word may introduce a value, never excuse one.
     * 07's English shape demanded a digit inside a single token, which let
     * "password is abcdefgh" and "password is correct horse battery staple"
     * through; a bare space still needs the digit-carrying token.
     */
    private static boolean secretPresent(String normalized) {
        if (SECRET_CREDENTIAL.matcher(normalized).find()) {
            return true;
        }
        Matcher assignment = SECRET_CJK_ASSIGNMENT.matcher(normalized);
        while (assignment.find()) {
            if (cjkAssignedValueBlocks(boundedAssignedValue(normalized, assignment.end()))) {
                return true;
            }
        }
        assignment = SECRET_ENGLISH_ASSIGNMENT.matcher(normalized);
        while (assignment.find()) {
            if (englishAssignedValueBlocks(boundedAssignedValue(normalized, assignment.end()))) {
                return true;
            }
        }
        return SECRET_BARE_SPACE.matcher(normalized).find();
    }

    /**
     * The disclosed value after an assignment start: begins after any
     * leftover separators/spaces ("密码是：hunter2" is the same disclosure
     * as "密码是 hunter2") and ends at the first sentence boundary or the
     * end of the text.
     */
    private static String boundedAssignedValue(String text, int start) {
        int valueStart = start;
        while (valueStart < text.length()) {
            char c = text.charAt(valueStart);
            if (c == ':' || c == '：' || c == '=' || Character.isWhitespace(c)) {
                valueStart++;
            } else {
                break;
            }
        }
        Matcher boundary = SECRET_VALUE_BOUNDARY.matcher(text);
        return boundary.find(valueStart)
                ? text.substring(valueStart, boundary.start())
                : text.substring(valueStart);
    }

    /**
     * CJK assignment rule (09): {@link #CJK_STATUS_PHRASE}s are consumed
     * from the left; a value made ENTIRELY of them is a complete state
     * description or help request ("忘记了请帮我重置", "太短了需要重新设置")
     * — clean. The first stretch the vocabulary cannot cover is the
     * residue, judged by the shared rule — a first token of ≥3 chars
     * carrying a digit ("密码是请保存hunter2secret") or a residue of ≥8
     * non-space chars ("密码是请记住abcdefgh"). 08's single-prefix veto let
     * a lone 请 excuse any value behind it; consumption cannot.
     */
    private static boolean cjkAssignedValueBlocks(String value) {
        String trimmed = value.strip();
        if (trimmed.isEmpty()) {
            return false;
        }
        Matcher phrase = CJK_STATUS_PHRASE.matcher(trimmed);
        int consumed = 0;
        while (consumed < trimmed.length()) {
            phrase.region(consumed, trimmed.length());
            if (!phrase.lookingAt()) {
                break;
            }
            consumed = phrase.end();
        }
        return residueBlocks(trimmed.substring(consumed));
    }

    /**
     * English copula rule (08/09): whitespace tokens are consumed from the
     * left while their word shape is in {@link #ENGLISH_STATUS_WORDS}; a
     * value made ENTIRELY of grammar words is a state/configuration
     * description ("currently being reset", "rejected and needs reset") —
     * clean. The FIRST token outside the vocabulary starts the residue,
     * judged by the shared rule — "password is currently abcdefgh",
     * "password is reset to abcdefgh" and "password is still correct horse
     * battery staple" all leave a value-shaped residue and block.
     */
    private static boolean englishAssignedValueBlocks(String value) {
        String trimmed = value.strip();
        if (trimmed.isEmpty()) {
            return false;
        }
        int residueStart = trimmed.length();
        int i = 0;
        while (i < trimmed.length()) {
            int tokenEnd = i;
            while (tokenEnd < trimmed.length()
                    && !Character.isWhitespace(trimmed.charAt(tokenEnd))) {
                tokenEnd++;
            }
            String token = trimmed.substring(i, tokenEnd);
            if (!ENGLISH_STATUS_WORDS.contains(wordShape(token))) {
                residueStart = i;
                break;
            }
            while (tokenEnd < trimmed.length()
                    && Character.isWhitespace(trimmed.charAt(tokenEnd))) {
                tokenEnd++;
            }
            i = tokenEnd;
        }
        return residueBlocks(trimmed.substring(residueStart));
    }

    /**
     * The shared judgment on what the grammar consumption could not excuse:
     * a first token of ≥3 chars carrying a digit, or a whole residue of ≥8
     * non-space chars (a long single token or a multi-word passphrase). An
     * empty residue means the value was entirely grammar — clean.
     */
    private static boolean residueBlocks(String residue) {
        if (residue.isEmpty()) {
            return false;
        }
        int space = whitespaceIndex(residue);
        return assignedValueBlocks(residue, space < 0 ? residue : residue.substring(0, space));
    }

    /**
     * The value judgment shared by both assignment shapes: a first token of
     * ≥3 chars carrying a digit, or a whole value of ≥8 non-space chars (a
     * long single token or a multi-word passphrase).
     */
    private static boolean assignedValueBlocks(String trimmedValue, String firstToken) {
        if (tokenCarriesDigit(firstToken)) {
            return true;
        }
        return trimmedValue.codePoints().filter(cp -> !Character.isWhitespace(cp)).count() >= 8;
    }

    /** The token lower-cased with edge punctuation stripped, for vocabulary lookup. */
    private static String wordShape(String token) {
        return token.replaceAll("^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "")
                .toLowerCase(Locale.ROOT);
    }

    /** A token of ≥3 chars carrying an ASCII digit (every Nd is already folded). */
    private static boolean tokenCarriesDigit(String token) {
        if (token.length() < 3) {
            return false;
        }
        return token.codePoints().anyMatch(cp -> cp >= '0' && cp <= '9');
    }

    private static int whitespaceIndex(String text) {
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 06: drop every code point whose general category is FORMAT (Cf) —
     * LRM U+200E, RLM U+200F, RLI U+2067, the soft hyphen U+00AD,
     * U+200B/200C/200D/2060/FEFF and the rest of the category, at code
     * point level so supplementary-plane Cf code points are covered too.
     * Runs AFTER NFKC and BEFORE the digit fold (NFKC → strip Cf → fold Nd).
     * Format code points carry no visible content, so stripping them cannot
     * forge data — it only re-joins what obfuscation split ("138\u200E00138000",
     * "密\u2067码是…").
     */
    private static String stripFormatCharacters(String text) {
        StringBuilder stripped = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            if (Character.getType(cp) != Character.FORMAT) {
                stripped.appendCodePoint(cp);
            }
            i += Character.charCount(cp);
        }
        return stripped.toString();
    }

    /**
     * 05/06: fold EVERY Unicode decimal-digit code point (general category
     * Nd) to its ASCII value, iterating by CODE POINT. Supplementary-plane
     * Nd digits (the U+1D7CE–U+1D7FF mathematical digits, Brahmi, …) arrive
     * as surrogate pairs, so a char-level loop never sees their category.
     * NFKC already covers the full-width forms and the mathematical block's
     * compatibility decompositions, but the Arabic-Indic block (U+0660-0669)
     * and most other scripts' digits carry no compatibility decomposition —
     * without this pass "١٣٨٠٠١٣٨٠٠٠" would pass as a non-number.
     */
    private static String normalizeDecimalDigits(String text) {
        StringBuilder folded = new StringBuilder(text.length());
        boolean changed = false;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            if (cp >= '0' && cp <= '9') {
                folded.append((char) cp);
            } else if (Character.getType(cp) == Character.DECIMAL_DIGIT_NUMBER) {
                int value = Character.getNumericValue(cp);
                if (value >= 0 && value <= 9) {
                    folded.append((char) ('0' + value));
                    changed = true;
                } else {
                    folded.appendCodePoint(cp);
                }
            } else {
                folded.appendCodePoint(cp);
            }
            i += Character.charCount(cp);
        }
        return changed ? folded.toString() : text;
    }

    private static boolean validResidentIdPresent(String compact) {
        Matcher matcher = RESIDENT_ID.matcher(compact);
        while (matcher.find()) {
            if (residentIdChecksumValid(matcher.group())) {
                return true;
            }
        }
        return false;
    }

    private static boolean residentIdChecksumValid(String candidate) {
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            int digit = candidate.charAt(i) - '0';
            if (digit < 0 || digit > 9) {
                return false;
            }
            sum += digit * RESIDENT_ID_WEIGHTS[i];
        }
        char expected = RESIDENT_ID_CHECK[sum % 11];
        char actual = Character.toUpperCase(candidate.charAt(17));
        return expected == actual;
    }

    private static boolean validBankCardPresent(String compact) {
        Matcher matcher = BANK_CARD.matcher(compact);
        while (matcher.find()) {
            if (luhnValid(matcher.group())) {
                return true;
            }
        }
        return false;
    }

    private static boolean luhnValid(String digits) {
        int sum = 0;
        boolean doubleDigit = false;
        for (int i = digits.length() - 1; i >= 0; i--) {
            int digit = digits.charAt(i) - '0';
            if (doubleDigit) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 == 0;
    }
}
