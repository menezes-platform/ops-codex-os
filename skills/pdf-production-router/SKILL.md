---
name: pdf-production-router
description: Use when creating, redesigning, or choosing tooling for polished PDF documents, especially editorial, educational, academic, proposal, report, workbook, infographic, certificate, or app-generated PDFs. Prefer reusable design systems and existing packages/templates over rebuilding layout from scratch.
---

# PDF Production Router

Own the tooling decision for high-quality PDF generation. The goal is not merely a valid PDF; it is a visually polished, reusable, automatable document system.

## Reuse-first rule

Before inventing layout primitives, inspect the current repository and available skills/templates. Use `reuse-first-router` when available and check mature ecosystem packages before creating custom components.

Do not redesign every document from zero. Prefer a shared design system with tokens, components, templates, and reference assets.

## Default stack

### 1. Typst — default for editorial PDFs

Use **Typst** first for:
- educational handouts and study guides;
- books, workbooks, exercises, exams, and answer keys;
- academic or technical documents with mathematics;
- professional reports and proposals;
- documents where typographic hierarchy, pagination, reusable components, and fast compilation matter.

Prefer the Typst package/template ecosystem before custom implementation. When building custom infrastructure, keep reusable pieces such as:
- cover / hero;
- chapter and section headers;
- concept / theorem / definition;
- example / exercise / solution;
- callout / warning / quote;
- formula blocks;
- tables / comparisons / timelines;
- headers, footers, page numbering;
- shared spacing, typography, palette, and grid tokens.

### 2. WeasyPrint — CSS-first secondary choice

Use **WeasyPrint** when the desired PDF is best expressed as HTML/CSS or needs web-like visual freedom.

Best fit:
- complex CSS layouts;
- branded reports that closely resemble web pages;
- workflows where HTML/CSS already exists;
- cases where CSS expertise or an existing web design system should be reused.

### 3. pdfme — template/data-driven documents

Use **pdfme** when a visual template is defined once and later populated with structured data.

Best fit:
- certificates;
- forms;
- invoices;
- recurring business documents;
- WYSIWYG/template-oriented generation.

### 4. React-PDF — application-integrated PDFs

Use **React-PDF** when PDF generation belongs inside an existing React/Node application and sharing application components/data flow is more important than editorial typesetting.

## Decision order

1. Inspect the repository for an existing PDF/document pipeline.
2. Inspect installed/user skills and reusable templates.
3. If editorial/educational/academic/proposal/report: choose Typst unless a concrete constraint says otherwise.
4. If layout should be HTML/CSS-first: choose WeasyPrint.
5. If the document is a fixed visual template populated with data: choose pdfme.
6. If PDF generation is a feature of a React/Node application: choose React-PDF.
7. Only build a custom PDF engine or low-level renderer when none of the above satisfies the requirement.

## Visual quality bar

A generated document should look intentionally designed, not like a default office export.

Prefer:
- clear hierarchy;
- generous but controlled whitespace;
- consistent grid and spacing;
- restrained palette;
- reusable components;
- strong cover and section openings;
- readable tables and formulas;
- light backgrounds by default unless the brief requires otherwise.

Avoid:
- generic Word-like formatting;
- arbitrary one-off spacing;
- excessive decorative elements;
- dense pages without hierarchy;
- rebuilding the same layout patterns for each PDF.

## Gabriel reference language

When appropriate to the brief, reuse the polished visual language previously established in `Proposta_Conthabil_Profissional.pdf` as a reference for professional/editorial documents rather than starting from a blank aesthetic.

Treat that file as a visual reference, not as a requirement to copy branding into unrelated documents.

## Output architecture

For a reusable Typst system, prefer a structure similar to:

```text
pdf-design/
├── main.typ
├── theme.typ
├── components/
│   ├── cover.typ
│   ├── callout.typ
│   ├── exercise.typ
│   ├── theorem.typ
│   ├── table.typ
│   └── footer.typ
├── assets/
└── content/
```

Keep content separate from presentation whenever practical so agents can update document content without redesigning the document.

## Completion check

Before declaring the PDF work done, verify:
- the chosen engine matches the document type;
- existing repository assets/templates were reused where appropriate;
- the visual system is consistent across pages;
- the final PDF renders without clipped or overlapping content;
- important text, tables, formulas, and page breaks are legible;
- the source remains reusable for future documents.
