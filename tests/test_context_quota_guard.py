from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
AGENTS = (ROOT / "global" / "AGENTS.md").read_text(encoding="utf-8")
SKILL = (ROOT / "skills" / "context-budget-manager" / "SKILL.md").read_text(encoding="utf-8")
PERSIST = (ROOT / "skills" / "persistent-conversation-controller" / "SKILL.md").read_text(encoding="utf-8")
GUARD = (ROOT / "persistd" / "src" / "quota-guard.js").read_text(encoding="utf-8")


class ContextQuotaGuardPolicyTests(unittest.TestCase):
    def test_runtime_guard_exists(self):
        self.assertIn("evaluateQuotaPressure", GUARD)
        self.assertIn("applyQuotaGuardToState", GUARD)
        self.assertIn("CONTEXT_RISK", GUARD)

    def test_thresholds_are_versioned_in_skill(self):
        for marker in (
            "quota >= 50%", "quota >= 65%", "quota >= 75%", "quota >= 85%",
            "context >= 45%", "context >= 60%", "context >= 72%", "context >= 85%",
            "burn >= 2 percentage points/minute", "burn >= 4 percentage points/minute",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, SKILL)

    def test_global_policy_makes_guard_mandatory(self):
        lowered = AGENTS.lower()
        self.assertIn("circuit breaker is mandatory", lowered)
        self.assertIn("preventive rollover", lowered)
        self.assertIn("must not perform polling loops", lowered)

    def test_persist_controller_records_telemetry_contract(self):
        for field in (
            "MODEL_QUOTA_USED_PERCENT", "MODEL_QUOTA_PREVIOUS_USED_PERCENT",
            "MODEL_QUOTA_SAMPLE_MINUTES", "MODEL_CONTEXT_TOKENS", "MODEL_CONTEXT_WINDOW",
        ):
            with self.subTest(field=field):
                self.assertIn(field, PERSIST)
        self.assertIn("QUOTA_GUARD_PRESERVE_QUALITY_GATES: true", PERSIST)

    def test_quality_is_never_traded_for_quota(self):
        combined = (AGENTS + SKILL + PERSIST).lower()
        self.assertIn("quality gates", combined)
        self.assertIn("independent review", combined)
        self.assertIn("safety", combined)
        self.assertIn("security", combined)


if __name__ == "__main__":
    unittest.main()