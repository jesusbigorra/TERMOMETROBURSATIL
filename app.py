import streamlit as st
import yfinance as yf
import pandas as pd
import os

# Configuración de la página en modo oscuro de un vistazo
st.set_page_config(page_title="JB TERMOMETRO BURSATIL", layout="wide")

# =========================================================================
# 🔐 CONFIGURACIÓN DE SEGURIDAD (ACCESO PERSONALIZADO)
# =========================================================================
CONTRASEÑA_CORRECTA = "JB2026"

# Barra lateral de control y acceso
st.sidebar.title("🔐 Control de Acceso")

# 🎨 ESPACIO PARA TU LOGO AUTOMATIZADO
if os.path.exists("logo.png"):
    st.sidebar.image("logo.png", use_container_width=True)

password_input = st.sidebar.text_input("Introduce la Clave de Acceso:", type="password")

# Verificación de Seguridad para desbloquear la Pizarra
if password_input != CONTRASEÑA_CORRECTA:
    st.sidebar.error("❌ Contraseña Incorrecta")
    st.title("📊 JB TERMOMETRO BURSATIL")
    st.warning("⚠️ Acceso Restringido. Introduce la clave secreta en la barra lateral para desbloquear el sistema de indicadores bursátiles en tiempo real.")
    st.info("💡 Si eres un usuario autorizado y no tienes tu código de acceso, ponte en contacto con Jesús Bigorra.")
else:
    # 🔓 SISTEMA DESBLOQUEADO - MOSTRAR PIZARRA REAL JB
    st.sidebar.success("🔓 Acceso Concedido")
    st.title("📊 Mi Pizarra JB TERMOMETRO BURSATIL")
    st.subheader("Detecta puntos clave para optimizar tus activos")

    # Tu portafolio real de 10 activos fijos solicitados
    MI_PORTAFOLIO = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"]

    tickers_input = st.text_input("Añade o modifica tus tickers (separados por comas):", value=", ".join(MI_PORTAFOLIO))
    tickers = [t.strip().upper() for t in tickers_input.split(",") if t.strip()]

    datos_pizarra = []

    if tickers:
        for ticker_symbol in tickers:
            try:
                ticker = yf.Ticker(ticker_symbol)
                # Descarga 1 año de historial en intervalo de 1 día de forma estricta
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
                
                # =========================================================================
                # 🎯 CALIBRACIÓN DEL RSI (14) EN VELAS DIARIAS (ALGORITMO FIEL A YAHOO FINANCE)
                # =========================================================================
                delta = df['Close'].diff()
                gain = delta.clip(lower=0)
                loss = -delta.clip(upper=0)
                
                # Suavizado exponencial de Wilder (alpha = 1/14)
                ema_gain = gain.ewm(alpha=1/14, adjust=False).mean()
                ema_loss = loss.ewm(alpha=1/14, adjust=False).mean()
                
                rs = ema_gain / ema_loss
                rsi = 100 - (100 / (1 + rs.iloc[-1]))
                
                # Clasificación Real Automatizada: Stock vs ETF
                info = ticker.info
                quote_type = info.get("quoteType", "").upper()
                tipo = "ETF" if quote_type == "ETF" else "Stock"
                
                # Lógica de las 4 Zonas de Compra Estrictas de Jesús
                if precio_actual < sma200:
                    posicion_str = "⚫ Debajo SMA200 (Cuarta zona de compra)"
                elif precio_actual < sma100:
                    posicion_str = "🔴 Debajo SMA100 (Tercera zona de compra)"
                elif precio_actual < sma50:
                    posicion_str = "🟢 Debajo SMA50 (Segunda zona de compra)"
                elif precio_actual < sma20:
                    posicion_str = "🔵 Debajo SMA20 (Primera zona de compra)"
                else:
                    posicion_str = "🚀 Sobre todas las SMA (Zonas superadas)"

                # Lógica de la Señal Semáforo (Alerta de compra: RSI bajo y tendencia viva)
                if precio_actual > sma50 and rsi < 60:
                    senal = "🟢 Interesante"
                else:
                    senal = "🟡 A considerar"
                    
                # Cálculo oficial del "Nivel JB"
                puntos_sma = 50 if precio_actual > sma50 else 20
                puntos_rsi = (1 - abs(rsi - 45)/55) * 50
                nivel_jb = int(puntos_sma + puntos_rsi)

                datos_pizarra.append({
                    "Ticker": ticker_symbol,
                    "Tipo": tipo,
                    "Precio Actual": f"${precio_actual:.2f}",
                    "Cambio %": f"{'+' if cambio_porcentaje > 0 else ''}{cambio_porcentaje:.2f}%",
                    "RSI (14)": f"{rsi:.2f}",
                    "Posición MAs": posicion_str,
                    "Señal": senal,
                    "Nivel JB": min(max(nivel_jb, 10), 100)
                })
            except Exception as e:
                pass

        # Desplegar la tabla estructurada en toda la pantalla
        if datos_pizarra:
            df_pizarra = pd.DataFrame(datos_pizarra)
            st.dataframe(df_pizarra, use_container_width=True, hide_index=True)
