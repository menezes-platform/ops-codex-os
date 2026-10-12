from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL_PATH = ROOT / "skills" / "shipping-functional-slices" / "SKILL.md"


class FunctionalSliceSkillContractTests(unittest.TestCase):
    def test_skill_discovery_and_metadata(self):
        self.assertTrue(SKILL_PATH.is_file())
        skill = SKILL_PATH.read_text(encoding="utf-8")
        self.assertRegex(skill, r"(?s)\A---\nname: shipping-functional-slices\ndescription: Use when .+?\n---\n")
        self.assertLess(len(skill.split("description:", 1)[1].split("\n", 1)[0]), 500)

    def test_first_task_is_real_executable_vertical_slice(self):
        skill = SKILL_PATH.read_text(encoding="utf-8").lower()
        for marker in ("task 1", "end-to-end", "real input", "observable result",
                       "acceptance", "evidence", "dod", "task 2+"):
            with self.subTest(marker=marker):
                self.assertIn(marker, skill)

    def test_guardrails_for_honest_completion_and_safety(self):
        skill = SKILL_PATH.read_text(encoding="utf-8").lower()
        for marker in ("blocked", "source-only", "security", "production",
                       "no deployment", "existing", "scope"):
            with self.subTest(marker=marker):
                self.assertIn(marker, skill)

    def test_global_route_and_human_discovery(self):
        agents = (ROOT / "global" / "AGENTS.md").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("$shipping-functional-slices", agents)
        self.assertIn("first executable vertical slice", agents.lower())
        self.assertIn("shipping-functional-slices", readme)
        install = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
        self.assertIn('$SourceSkills = Join-Path $RepoRoot "skills\\*"', install)


if __name__ == "__main__":
    unittest.main()
