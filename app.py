import streamlit as st
import yfinance as yf
import pandas as pd
import os

# Configuración de la página en modo oscuro
st.set_page_config(page_title="JB TERMOMETRO BURSATIL", page_icon="🌡️", layout="wide")

# =========================================================================
# 🔐 CONFIGURACIÓN DE SEGURIDAD (ACCESO PERSONALIZADO)
# =========================================================================
CONTRASEÑA_CORRECTA = "JB2026"

# Barra lateral de control y acceso
st.sidebar.title("🔐 Control de Acceso")

# 🎨 TU LOGO ESPECTACULAR SE QUEDA AQUÍ TOTALMENTE INTACTO
if os.path.exists("logo.png"):
    st.sidebar.image("logo.png", use_container_width=True)
elif os.path.exists("logo.jpg"):
    st.sidebar.image("logo.jpg", use_container_width=True)

password_input = st.sidebar.text_input("Introduce la Clave de Acceso:", type="password")

# Verificación de Seguridad para desbloquear la Pizarra
if password_input != CONTRASEÑA_CORRECTA:
    st.sidebar.error("❌ Contraseña Incorrecta")
    st.title("🌡️ JB TERMOMETRO BURSATIL")
    st.warning("⚠️ Acceso Restringido. Introduce la clave secreta en la barra lateral para desbloquear el sistema de indicadores bursátiles en tiempo real.")
    st.info("💡 Si eres un usuario autorizado y no tienes tu código de acceso, ponte en contacto con Jesús Bigorra.")
else:
    # 🔓 SISTEMA DESBLOQUEADO - MOSTRAR PIZARRA REAL JB
    st.sidebar.success("🔓 Acceso Concedido")
    
    # El icono y título principal
    st.title("🌡️📈 Mi Pizarra JB TERMOMETRO BURSATIL")
    st.subheader("Detecta puntos clave para optimizar tus activos")

    # Tu portafolio real de 10 activos fijos
    MI_PORTAFOLIO = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"]

    tickers_input = st.text_input("Añade o modifica tus tickers (separados por comas):", value=", ".join(MI_PORTAFOLIO))
    tickers = [t.strip().upper() for t in tickers_input.split(",") if t.strip()]

    datos_pizarra = []

    if tickers:
        for ticker_symbol in tickers:
            try:
                ticker = yf.Ticker(ticker_symbol)
                df = ticker.history(period="1y")
                
                if df.empty:
                    continue
                    
                # Precios y Variación Diaria
                precio_actual = df['Close'].iloc[-1]
                precio_anterior = df['Close'].iloc[-2]
                cambio_porcentaje = ((precio_actual - precio_anterior) / precio_anterior) * 100
                
                # Medias Móviles (SMA)
                sma20 = df['Close'].rolling(window=20).mean().iloc[-1]
                sma50 = df['Close'].rolling(window=50).mean().iloc[-1]
                sma100 = df['Close'].rolling(window=100).mean().iloc[-1]
                sma200 = df['Close'].rolling(window=200).mean().iloc[-1]
                
                # Calibración del RSI (14) Wilder
                delta = df['Close'].diff()
                gain = delta.clip(lower=0)
                loss = -delta.clip(upper=0)
                ema_gain = gain.ewm(alpha=1/14, adjust=False).mean()
                ema_loss = loss.ewm(alpha=1/14, adjust=False).mean()
                rs = ema_gain / ema_loss
                rsi = 100 - (100 / (1 + rs.iloc[-1]))
                
                # Clasificación Stock vs ETF
                info = ticker.info
                quote_type = info.get("quoteType", "").upper()
                tipo = "ETF" if quote_type == "ETF" else "Stock"
                
                # Asignación de Puntos por Medias Móviles
                if precio_actual < sma200:
                    posicion_str = "⚫ Debajo SMA200 (Cuarta zona de compra)"
                    puntos_sma = 50
                elif precio_actual < sma100:
                    posicion_str = "🔴 Debajo SMA100 (Tercera zona de compra)"
                    puntos_sma = 40
                elif precio_actual < sma50:
                    posicion_str = "🟢 Debajo SMA50 (Segunda zona de compra)"
                    puntos_sma = 30
                elif precio_actual < sma20:
                    posicion_str = "🔵 Debajo SMA20 (Primera zona de compra)"
                    puntos_sma = 20
                else:
                    posicion_str = "❌ Sobre todas las SMA (Altos históricos)"
                    puntos_sma = 0

                # Ecuación del RSI Protagonista
                puntos_rsi = (70 - rsi) * 1.25
                puntos_rsi = max(0.0, min(50.0, puntos_rsi))

                # Evaluación Estricta de Señales
                if rsi >= 65 or puntos_sma == 0:
                    senal = "🔴 Descartado de momento"
                    nivel_jb = 10  
                elif rsi <= 40 and puntos_sma >= 30:
                    senal = "🟢 Interesante"
                    nivel_jb = int(puntos_sma + puntos_rsi)
                else:
                    senal = "🟡 A considerar"
                    nivel_jb = int(puntos_sma + puntos_rsi)

                nivel_jb = min(max(nivel_jb, 10), 100)

                # =========================================================================
                # 🎯 CONSTRUCCIÓN DE LINKS MULTI-PLATAFORMA INTERNACIONALES
                # =========================================================================
                url_yahoo = f"https://es-us.finanzas.yahoo.com/chart/{ticker_symbol}"
                url_etf = f"https://www.etf.com/{ticker_symbol}" if tipo == "ETF" else None
                url_mstar = f"https://www.morningstar.com/search?query={ticker_symbol}"
                url_finviz = f"https://finviz.com/quote.ashx?t={ticker_symbol}"

                datos_pizarra.append({
                    "Ticker": url_yahoo,
                    "ETF.com": url_etf,
                    "M-Star": url_mstar,
                    "Finviz": url_finviz,
                    "Tipo": tipo,
                    "Precio Actual": f"${precio_actual:.2f}",
                    "Cambio %": f"{'+' if cambio_porcentaje > 0 else ''}{cambio_porcentaje:.2f}%",
                    "RSI (14) Wilder": f"{rsi:.2f}",
                    "Posición MAs": posicion_str,
                    "Señal": senal,
                    "Nivel JB": nivel_jb
                })
            except Exception as e:
                pass

        # =========================================================================
        # 🔓 RENDERIZADO AVANZADO DE BOTONES EMOJI MULTI-LINK
        # =========================================================================
        if datos_pizarra:
            df_pizarra = pd.DataFrame(datos_pizarra)
            st.dataframe(
                df_pizarra, 
                use_container_width=True, 
                hide_index=True,
                column_config={
                    "Ticker": st.column_config.LinkColumn(
                        "Ticker",
                        display_text=r"https://es-us\.finanzas\.yahoo\.com/chart/(.*)",
                        help="Gráfico avanzado e indicadores en Yahoo Finance"
                    ),
                    "ETF.com": st.column_config.LinkColumn(
                        "ETF.com",
                        display_text="🟢",
                        help="Ficha de costos y distribución en ETF.com (Solo para ETFs)"
                    ),
                    "M-Star": st.column_config.LinkColumn(
                        "M-Star",
                        display_text="🔴",
                        help="Análisis de estrellas y valor fundamental en Morningstar"
                    ),
                    "Finviz": st.column_config.LinkColumn(
                        "Finviz",
                        display_text="📊",
                        help="Radiografía fundamental rápida en Finviz"
                    ),
                }
            )
       
