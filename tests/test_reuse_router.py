from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
ROUTER = (ROOT / "skills" / "reuse-first-router" / "SKILL.md").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")

VENDORS = {
    "motion-primitives": "https://github.com/ibelick/motion-primitives.git",
    "watermelon-platform": "https://github.com/WatermelonCorp/watermelon-platform.git",
    "fontsource": "https://github.com/fontsource/fontsource.git",
    "OpenManus": "https://github.com/FoundationAgents/OpenManus.git",
    "skill-manus": "https://github.com/reubenjohn/skill-manus.git",
    "design-agent-skills": "https://github.com/podo/design-agent-skills.git",
}

DESIGN_DIRECT_EXCEPTIONS = {
    "brandkit": "nexu-io/open-design",
    "canvas-design": "anthropics/skills",
    "remotion-best-practices": "remotion-dev/skills",
}

DESIGN_COHORT = (
    "frontend-design", "impeccable", "taste-skill", "make-interfaces-better", "color-expert", "design-tokens-skill", "design-system-governance",
    "brandkit", "format-storybook", "mobile-app-design", "canvas-design", "algorithmic-art", "p5js-hermes", "shader-dev",
    "animate-skill", "css-animation-skill", "wiggle-claude-skill", "remotion-best-practices", "work-with-design-systems", "extract-design-md", "taste-design-stitch",
    "design-html", "information-architecture-and-navigation", "interfaces-that-feel", "search-ux", "neo-user-journey", "design-auditor", "fixing-accessibility",
    "design-brief", "design-consultation", "ux-writing-skill", "content-strategy", "copywriting-skill", "product-position", "user-research-cookiy",
    "software-ux-research", "plan-design-review", "design-review-garrytan", "design-debt-audit", "design-impact-reporting", "cloudflare-web-perf", "dark-pattern-audit",
)


class ReuseRouterVendorTests(unittest.TestCase):
    def test_installer_tracks_all_new_vendor_repositories(self):
        for name, url in VENDORS.items():
            with self.subTest(name=name):
                self.assertIn(f'Name = "{name}"', INSTALL)
                self.assertIn(f'Url = "{url}"', INSTALL)

    def test_router_exposes_visual_typography_and_manus_routes(self):
        expected = [
            "motion-primitives",
            "watermelon-platform",
            "fontsource",
            "https://github.com/google/fonts",
            "OpenManus",
            "skill-manus",
            "haikei.app",
            "nowork-studio/notfair-plugin",
            "web-seo-baseline",
            "trophyso/ui",
            "marquespq/questro",
            "gamification-baseline",
        ]
        for marker in expected:
            with self.subTest(marker=marker):
                self.assertIn(marker, ROUTER)

    def test_router_exposes_public_api_discovery_route(self):
        lowered = ROUTER.lower()
        for marker in (
            "public-apis/public-apis",
            "public api discovery",
            "official provider documentation",
            "scraping",
            "rate limits",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, lowered)

    def test_readme_documents_public_api_discovery_route(self):
        lowered = README.lower()
        for marker in ("public-apis/public-apis", "api pública", "scraping", "documentação oficial"):
            with self.subTest(marker=marker):
                self.assertIn(marker, lowered)

    def test_router_exposes_curated_frontend_source_routes(self):
        lowered = ROUTER.lower()
        for marker in (
            "referodesign/refero_skill",
            "nolly-studio/cult-ui",
            "ruucm/shadergradient",
            "cult pro",
            "prefers-reduced-motion",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, lowered)

    def test_router_requires_project_specific_frontend_identity(self):
        lowered = ROUTER.lower()
        for marker in (
            "project-specific visual thesis",
            "implementation source, not visual direction",
            "domain-specific assets",
            "signature interactions",
            "transplant test",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, lowered)

    def test_router_routes_design_catalogue_on_demand(self):
        for marker in ("podo/design-agent-skills", "design-catalogue", "on-demand"):
            with self.subTest(marker=marker):
                self.assertIn(marker, ROUTER)

    def test_router_preserves_preferred_design_cohort(self):
        self.assertEqual(42, len(DESIGN_COHORT))
        for marker in DESIGN_COHORT:
            with self.subTest(marker=marker):
                self.assertIn(marker, ROUTER)

    def test_readme_documents_design_catalogue_policy(self):
        for marker in ("design-agent-skills", "42", "on-demand"):
            with self.subTest(marker=marker):
                self.assertIn(marker, README)

    def test_router_has_direct_sources_for_catalogue_gaps(self):
        for skill, source in DESIGN_DIRECT_EXCEPTIONS.items():
            with self.subTest(skill=skill):
                self.assertIn(skill, ROUTER)
                self.assertIn(source, ROUTER)

    def test_router_distinguishes_official_manus_from_community_candidates(self):
        self.assertIn("https://github.com/manus-ai", ROUTER)
        self.assertIn("official Manus", ROUTER)
        self.assertIn("https://github.com/manus-ai", README)

    def test_readme_documents_new_routes_and_haikei_policy(self):
        for marker in ["motion-primitives", "watermelon-platform", "OpenManus", "skill-manus", "haikei.app"]:
            with self.subTest(marker=marker):
                self.assertIn(marker, README)
        self.assertIn("web/reference-only", README)

    def test_router_covers_public_private_and_external_reuse(self):
        agents = (ROOT / "global" / "AGENTS.md").read_text(encoding="utf-8")
        for marker in ("public, private, and internal repositories", "Paginate repository metadata", "external public/open-source repositories"):
            with self.subTest(marker=marker):
                self.assertIn(marker, agents)
        for marker in ("Tier 0.5 — Cross-repository inventory", "public, private, and internal repositories", "Paginate the inventory", "external public/open-source GitHub repositories", "not accessible"):
            with self.subTest(marker=marker):
                self.assertIn(marker, ROUTER)

if __name__ == "__main__":
    unittest.main()
