#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "  ================================================"
echo "   Deploy Firebase - Controle de Ponto"
echo "  ================================================"
echo ""
firebase deploy
echo ""
echo "  Deploy concluido!"
