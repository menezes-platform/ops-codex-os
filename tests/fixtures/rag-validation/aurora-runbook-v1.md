# Laboratório Aurora — documento de teste de recuperação

Versão: aurora-runbook-v1. Documento fictício, sem dados pessoais, usado exclusivamente para validação técnica de RAG.

## Retenção dos arquivos

O Laboratório Aurora cria uma cópia de segurança a cada 17 minutos. Mantém nove gerações completas. Cada arquivo tem um checksum SHA-256 calculado antes da cópia e conferido após a leitura do armazenamento.

## Procedimento após interrupção

Após uma interrupção, a equipe restaura a geração anterior íntegra e confere novamente o checksum SHA-256. Só então retoma o catálogo de sementes. Uma geração incompleta nunca substitui a cópia anterior.

## Controle sem relação com recuperação

As etiquetas das sementes de manjericão são verdes. As etiquetas das sementes de girassol são amarelas. O inventário das estufas acontece às quartas-feiras.
