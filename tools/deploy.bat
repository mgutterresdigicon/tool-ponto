@echo off
cd /d "%~dp0.."
echo.
echo   ================================================
echo    Deploy Firebase - Controle de Ponto
echo   ================================================
echo.
firebase deploy
echo.
echo   Deploy concluido!
pause
