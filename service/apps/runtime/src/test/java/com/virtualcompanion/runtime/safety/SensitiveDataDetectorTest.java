package com.virtualcompanion.runtime.safety;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-STABILIZATION-02 defect 2: the local sensitive-data gate is a real
 * detector for ordinary personal data — the deterministic safety classifier
 * covers grief/crisis/credential hard rules but lets an id number, bank
 * card, mobile, email, address or verification code pass clean, so it must
 * never stand in as this detector. Positives below all previously flowed
 * through the deterministic classifier as fully clean.
 */
class SensitiveDataDetectorTest {

    private final SensitiveDataDetector detector = new SensitiveDataDetector();

    @Test
    void detectsOrdinaryPersonalData() {
        assertThat(detector.detect("我的手机号 13800138000，有事打给我"))
                .containsExactly("MOBILE");
        assertThat(detector.detect("手机号是 138 0013 8000"))
                .as("digit separators are folded before matching")
                .containsExactly("MOBILE");
        assertThat(detector.detect("身份证号 11010519491231002X 请核对"))
                .containsExactly("RESIDENT_ID");
        assertThat(detector.detect("身份证 110105 19491231 002x"))
                .containsExactly("RESIDENT_ID");
        assertThat(detector.detect("卡号 6222020200001234562 明天扣款"))
                .containsExactly("BANK_CARD");
        // A second Luhn-valid card shape (4111 1111 1111 1111).
        assertThat(detector.detect("visa 4111-1111-1111-1111 过期了"))
                .containsExactly("BANK_CARD");
        assertThat(detector.detect("发到 someone@example.com 就行"))
                .containsExactly("EMAIL");
        assertThat(detector.detect("我家在北京市海淀区中关村大街27号"))
                .containsExactly("ADDRESS");
        assertThat(detector.detect("收货地址：幸福路 12 号 3 单元"))
                .as("road + house number alone is address-like")
                .containsExactly("ADDRESS");
        assertThat(detector.detect("我的密码是 hunter2secret"))
                .containsExactly("SECRET");
        assertThat(detector.detect("api_key: sk-abc123def456ghi789jkl012"))
                .containsExactly("SECRET");
        assertThat(detector.detect("验证码 123456 十分钟内有效"))
                .containsExactly("OTP");
        assertThat(detector.detect("verification code: 998877"))
                .containsExactly("OTP");
    }

    @Test
    void ordinaryConversationsStayClean() {
        List<String> plain = List.of(
                "今天天气不错",
                "帮我写一首关于春天的诗",
                "我有点难过，想聊聊",
                "订单号 20260824-001 已经发货了吗",
                "时间戳 1724515200000 是什么时候",
                "我在上海市上班，通勤有点累",
                "今天路上堵车，到家八点半",
                "密码学的历史很有意思",
                "验证码已发送，请查收短信",
                "这本书第三百一十二页很有意思");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }

    @Test
    void longNumbersWithoutValidChecksumsStayClean() {
        // 18 digits but the GB 11643 checksum fails; also fails Luhn, so it
        // is neither a resident id nor a bank card (an order id, say).
        assertThat(detector.detect("单号 110105194912310021")).isEmpty();
        // 19 digits, Luhn fails.
        assertThat(detector.detect("流水号 6222020200001234568")).isEmpty();
    }

    @Test
    void multipleCategoriesReportInFixedOrder() {
        assertThat(detector.detect(
                "手机 13800138000，邮箱 a@b.co，验证码 223344，住址幸福路 9 号"))
                .containsExactly("EMAIL", "MOBILE", "ADDRESS", "OTP");
    }

    @Test
    void blankAndNullStayClean() {
        assertThat(detector.detect(null)).isEmpty();
        assertThat(detector.detect("")).isEmpty();
        assertThat(detector.detect("   ")).isEmpty();
    }

    @Test
    void obfuscatedPhoneSpellingsAreNormalizedAndCaught() {
        assertThat(detector.detect("手机 +86 13800138000，随时联系"))
                .as("+86 with a space still carries the same mobile")
                .containsExactly("MOBILE");
        assertThat(detector.detect("电话+8613800138000"))
                .as("+86 glued to the number")
                .containsExactly("MOBILE");
        assertThat(detector.detect("138(0013)8000 打这个"))
                .as("parenthesised digit groups are separators too")
                .containsExactly("MOBILE");
        assertThat(detector.detect("１３８００１３８０００ 这是我的号"))
                .as("full-width digits normalize to ASCII before matching")
                .containsExactly("MOBILE");
        assertThat(detector.detect("卡号 ６２２２０２０２００００１２３４５６２"))
                .as("full-width bank card digits normalize before the Luhn check")
                .containsExactly("BANK_CARD");
    }

    @Test
    void zeroWidthInsertionsDoNotEvadeTheSecretPatterns() {
        assertThat(detector.detect("我的密\u200B码是 hunter2secret"))
                .as("a zero-width space inside the keyword must not split it")
                .containsExactly("SECRET");
        assertThat(detector.detect("api\u200Dkey: hunter2secret"))
                .as("a zero-width joiner inside api key must not split it")
                .containsExactly("SECRET");
        assertThat(detector.detect("密\uFEFF码：\u200Bhunter2secret"))
                .as("zero-width chars around the separator and value are stripped")
                .containsExactly("SECRET");
    }

    @Test
    void spaceSeparatedSecretValuesAreCaught() {
        assertThat(detector.detect("我的密码 hunter2secret"))
                .as("a bare space after the keyword is a secret disclosure too")
                .containsExactly("SECRET");
        assertThat(detector.detect("my password is hunter2secret"))
                .as("the English copula form is a secret disclosure too")
                .containsExactly("SECRET");
    }

    @Test
    void ordinarySentencesWithAddressOrSecretWordsStayClean() {
        List<String> plain = List.of(
                "这个市区道路很宽",
                "市区道路四通八达，开车很方便",
                "县道上车不多，骑得很顺",
                "请重置密码后重新登录",
                "密码学的历史很有意思",
                "tokens are cheap in this town");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }

    @Test
    void zeroFiveRoundBlockedSamplesAreAllCaught() {
        // The 05 acceptance samples: country-code and separator spellings of
        // the mobile number, the Arabic-Indic digit spelling, the soft-hyphen
        // keyword split, and an explicit home-address disclosure without a
        // house number.
        assertThat(detector.detect("手机 0086 13800138000"))
                .containsExactly("MOBILE");
        assertThat(detector.detect("138,0013,8000"))
                .containsExactly("MOBILE");
        assertThat(detector.detect("138·0013·8000"))
                .containsExactly("MOBILE");
        assertThat(detector.detect("١٣٨٠٠١٣٨٠٠٠"))
                .as("Arabic-Indic digits NFKC-fold to ASCII")
                .containsExactly("MOBILE");
        assertThat(detector.detect("密\u00AD码是 hunter2secret"))
                .as("a soft hyphen inside the keyword must not split it")
                .containsExactly("SECRET");
        assertThat(detector.detect("我家地址是北京市海淀区中关村大街"))
                .as("an explicit address disclosure needs no house number")
                .containsExactly("ADDRESS");
    }

    @Test
    void zeroFiveRoundCleanSamplesStayClean() {
        // Ordinary keyword phrases and location prose carry no disclosure
        // structure: the secret value must contain a digit or be a long
        // credential-like word, and the address category requires a number
        // or an explicit disclosure context.
        List<String> plain = List.of(
                "token budget 128",
                "password manager",
                "API key rotation policy",
                "我在上海市上班",
                "这个市区道路很宽");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }

    @Test
    void zeroSixRoundBlockedSamplesAreAllCaught() {
        assertThat(detector.detect("138\u200E00138000"))
                .as("LRM (Cf) inside the number is stripped, revealing the mobile")
                .containsExactly("MOBILE");
        assertThat(detector.detect("密\u2067码是 hunter2secret"))
                .as("RLI (Cf) inside the keyword is stripped, revealing the assignment shape")
                .containsExactly("SECRET");
        // U+1D7E2-U+1D7EB mathematical sans-serif digits spelling 13800138000
        // (1→U+1D7E3, 3→U+1D7E5, 8→U+1D7EA, 0→U+1D7E2): supplementary-plane
        // Nd code points that only a code-point-level fold can classify.
        assertThat(detector.detect(
                "\uD835\uDFE3\uD835\uDFE5\uD835\uDFEA\uD835\uDFE2\uD835\uDFE2"
                        + "\uD835\uDFE3\uD835\uDFE5\uD835\uDFEA\uD835\uDFE2\uD835\uDFE2\uD835\uDFE2"))
                .as("supplementary-plane Nd digits fold to an ASCII mobile")
                .containsExactly("MOBILE");
        assertThat(detector.detect("密码是 correct horse battery staple"))
                .as("assignment context: multi-word passphrase totals >=8 chars")
                .containsExactly("SECRET");
        assertThat(detector.detect("密码是 abcdefgh"))
                .as("assignment context: single token >=8 chars")
                .containsExactly("SECRET");
    }

    @Test
    void zeroSixRoundCleanSamplesStayClean() {
        // 06: a merely long word after a keyword is prose, and the address
        // context needs TWO administrative levels — a settings phrase with
        // one suffix ("选择城市", "在市区更新") is not a disclosure.
        List<String> plain = List.of(
                "password management",
                "token performance",
                "API key configuration",
                "password forgotten",
                "我的地址选择城市",
                "我的地址需要在市区更新");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }

    @Test
    void zeroSevenRoundCleanSamplesStayClean() {
        // 07: the assigned secret value must be a BOUNDED disclosure (the
        // value ends at the first sentence boundary, so prose in the NEXT
        // clause cannot be counted into the value), an English is/are
        // assignment needs a single digit-carrying token, and the address
        // context no longer stitches 城市/地区/城区 compound tails into two
        // administrative levels.
        List<String> plain = List.of(
                "密码是忘记了，请帮我重置",
                "password is forgotten and needs reset",
                "token is performance budget setting",
                "我的地址选择城市功能并支持地区筛选",
                "我的地址选择城市后设置城区偏好");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
        // The bounded judgment must not loosen the blocked shapes: a second
        // separator after the assignment word is still an assignment, and a
        // real two-level address after the keyword still blocks.
        assertThat(detector.detect("密码是：hunter2secret"))
                .as("a second separator after the assignment word is still an assignment")
                .containsExactly("SECRET");
        assertThat(detector.detect("我家地址是北京市海淀区中关村大街"))
                .containsExactly("ADDRESS");
    }

    @Test
    void zeroEightRoundBlockedSamplesAreAllCaught() {
        // 08/D: English assignments must block digit-free disclosures again —
        // a long single token or a multi-word passphrase — unless the value
        // opens with a status/configuration word.
        assertThat(detector.detect("password is abcdefgh"))
                .as("a digit-free single-token password behind the English copula")
                .containsExactly("SECRET");
        assertThat(detector.detect("password is correct-horse-battery-staple"))
                .as("the hyphenated passphrase spelling")
                .containsExactly("SECRET");
        assertThat(detector.detect("password is correct horse battery staple"))
                .as("the multi-word passphrase behind the English copula")
                .containsExactly("SECRET");
        assertThat(detector.detect("my API key is abcdefghijklmnop"))
                .containsExactly("SECRET");
        // 08/E regression guards: the CJK assignment shapes and the
        // relation-backed address disclosures from earlier rounds.
        assertThat(detector.detect("密码是 correct horse battery staple"))
                .containsExactly("SECRET");
        assertThat(detector.detect("密码是 abcdefgh"))
                .containsExactly("SECRET");
        assertThat(detector.detect("我的密码是 hunter2secret"))
                .containsExactly("SECRET");
        assertThat(detector.detect("我家地址是北京市海淀区中关村大街"))
                .as("a real assignment relation between keyword and divisions")
                .containsExactly("ADDRESS");
        assertThat(detector.detect("收货地址：北京市海淀区中关村大街27号"))
                .containsExactly("ADDRESS");
    }

    @Test
    void zeroEightRoundCleanSamplesStayClean() {
        // 08/E: a punctuation-free status complaint stays clean (the bounded
        // value opens with a CJK status/help prefix even when the help
        // request runs into the value), and two real admin divisions behind
        // a selection verb are a settings description, not a disclosure.
        // 08/D: an English assignment whose value opens with a status/
        // configuration word is a description, not a disclosure.
        List<String> plain = List.of(
                "密码是忘记了请帮我重置",
                "密码是错误的需要重新设置",
                "我的地址选择北京市后设置海淀区偏好",
                "收货地址可以选择北京市或者天津市",
                "password is forgotten and needs reset",
                "password is incorrect and needs reset",
                "token is performance budget setting",
                "password management",
                "API key rotation policy");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }

    @Test
    void zeroNineRoundBlockedSamplesAreAllCaught() {
        // 09/A: an aspect adverb or status verb may only INTRODUCE an
        // assigned English value, never excuse it — the residue after the
        // consumed grammar vocabulary is judged by the shared value rule.
        assertThat(detector.detect("password is currently abcdefgh"))
                .as("an adverb ahead of a digit-free single token")
                .containsExactly("SECRET");
        assertThat(detector.detect("password is currently set to abcdefgh"))
                .containsExactly("SECRET");
        assertThat(detector.detect("password is still correct horse battery staple"))
                .containsExactly("SECRET");
        assertThat(detector.detect("password is already abcdefgh"))
                .containsExactly("SECRET");
        assertThat(detector.detect("password is reset to abcdefgh"))
                .as("the value after a status verb's to")
                .containsExactly("SECRET");
        assertThat(detector.detect("password is changed to correct horse battery staple"))
                .containsExactly("SECRET");
        assertThat(detector.detect("API key is rotated to abcdefghijklmnop"))
                .containsExactly("SECRET");
        assertThat(detector.detect("token is already abcdefghijklmnop"))
                .containsExactly("SECRET");
        // 09/B: a CJK help/status phrase must form a COMPLETE state
        // description — a lone 请 may not excuse the value glued behind it.
        assertThat(detector.detect("密码是请记住abcdefgh"))
                .containsExactly("SECRET");
        assertThat(detector.detect("密码是请保存hunter2secret"))
                .containsExactly("SECRET");
        assertThat(detector.detect("密码是改成abcdefgh"))
                .containsExactly("SECRET");
        assertThat(detector.detect("密钥是请使用abcdefgh1234"))
                .containsExactly("SECRET");
        // 09/C: a location/change relation and a pure-whitespace form
        // separator are disclosure relations too.
        assertThat(detector.detect("我家地址在北京市海淀区中关村大街"))
                .as("the location relation 在")
                .containsExactly("ADDRESS");
        assertThat(detector.detect("住址在北京市海淀区中关村大街"))
                .containsExactly("ADDRESS");
        assertThat(detector.detect("家庭住址 北京市海淀区中关村大街"))
                .as("a whitespace form separator is an assignment")
                .containsExactly("ADDRESS");
        assertThat(detector.detect("家庭住址    北京市海淀区中关村大街"))
                .containsExactly("ADDRESS");
        assertThat(detector.detect("收货地址改成北京市海淀区中关村大街"))
                .as("the change relation 改成")
                .containsExactly("ADDRESS");
    }

    @Test
    void zeroNineRoundCleanSamplesStayClean() {
        // 09: a value made ENTIRELY of state/grammar words is a description
        // (English and CJK alike), and two real divisions behind a selection
        // verb or in ordinary location prose stay settings phrases.
        List<String> plain = List.of(
                "password is currently being reset",
                "password is still incorrect and needs reset",
                "password is too short and needs reset",
                "password is rejected and needs reset",
                "API key rotation policy",
                "token performance budget 128",
                "密码是忘记了请帮我重置",
                "密码是错误的需要重新设置",
                "密码是太短了需要重新设置",
                "密码是复杂度不足需要重设",
                "密码无法使用请帮我重置",
                "我的地址选择北京市后设置海淀区偏好",
                "收货地址可以选择北京市或者天津市",
                "我在上海市上班",
                "这个市区道路很宽");
        for (String text : plain) {
            assertThat(detector.detect(text))
                    .as("must stay clean: %s", text)
                    .isEmpty();
        }
    }
}
