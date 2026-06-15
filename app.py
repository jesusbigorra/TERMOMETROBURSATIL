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

    # =========================================================================
    # 📡 CONTROL AUTOMATIZADO DEL RADAR JB (MEMORIA DE TICKERS CON DESTRUCCIÓN "X")
    # =========================================================================
    if "radar_tickers" not in st.session_state:
        st.session_state.radar_tickers = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"]

    st.write("### 📡 Panel de Control del Radar JB")
    
    # Formulario limpio para agregar nuevos activos sin perder la lista actual
    with st.form("form_radar", clear_on_submit=True):
        col1, col2 = st.columns([3, 1])
        with col1:
            nuevo_ticker = st.text_input("✍️ Escribe un nuevo Ticker para agregarlo al Radar (ej: AAPL, TSLA, BTC-USD):").strip().upper()
        with col2:
            btn_agregar = st.form_submit_button("➕ Agregar al Radar")
            
        if btn_agregar and nuevo_ticker:
            if nuevo_ticker not in st.session_state.radar_tickers:
                st.session_state.radar_tickers.append(nuevo_ticker)
                st.rerun()

    # Caja interactiva con botones "X" nativos para eliminar del radar al instante
    tickers_filtrados = st.multiselect(
        "📋 Activos bajo la lupa en tu Radar actual (Haz clic en la 'X' de cualquiera para eliminarlo permanentemente):",
        options=st.session_state.radar_tickers,
        default=st.session_state.radar_tickers
    )

    # Si el usuario eliminó un activo usando la "X", actualizamos la memoria interna de inmediato
    if tickers_filtrados != st.session_state.radar_tickers:
        st.session_state.radar_tickers = tickers_filtrados
        st.rerun()

    datos_pizarra = []

    if tickers_filtrados:
        for ticker_symbol in tickers_filtrados:
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
                
                # Clasificación Real Automatizada: Stock vs ETF
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
                # 🎯 INGENIERÍA DE DEEP-LINKS EXACTOS (SOPORTE MULTI-PLATAFORMA MILIMÉTRICO)
                # =========================================================================
                url_yahoo = f"https://es-us.finanzas.yahoo.com/chart/{ticker_symbol}"
                url_finviz = f"https://finviz.com/quote.ashx?t={ticker_symbol}"
                
                # Enlace inteligente para ETF.com (Si es stock, busca para evitar el "None")
                if tipo == "ETF":
                    url_etf = f"https://www.etf.com/{ticker_symbol}"
                else:
                    url_etf = f"https://www.etf.com/search?q={ticker_symbol}"
                
                # Enlace de precisión quirúrgica para Morningstar (Mapeando la Bolsa del activo)
                exchange = info.get("exchange", "").upper()
                if tipo == "ETF":
                    if "NAS" in exchange or "NMS" in exchange:
                        exch_code = "xnas"
                    elif "BATS" in exchange:
                        exch_code = "bats"
                    else:
                        exch_code = "arcx"
                    url_mstar = f"https://www.morningstar.com/etfs/{exch_code}/{ticker_symbol.lower()}/quote"
                else:
                    if "NAS" in exchange or "NMS" in exchange:
                        exch_code = "xnas"
                    elif "NYE" in exchange or "NYQ" in exchange or "NYSE" in exchange:
                        exch_code = "xnys"
                    else:
                        exch_code = "xnas"
                    url_mstar = f"https://www.morningstar.com/stocks/{exch_code}/{ticker_symbol.lower()}/quote"

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
        # 🔓 RENDERIZADO AVANZADO DE TABLA PREMIUM
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
                        help="Gráfico avanzado interactivo en Yahoo Finance"
                    ),
                    "ETF.com": st.column_config.LinkColumn(
                        "ETF.com",
                        display_text="🟢",
                        help="Análisis de costos y holdings en ETF.com"
                    ),
                    "M-Star": st.column_config.LinkColumn(
                        "M-Star",
                        display_text="🔴",
                        help="Ficha de Morningstar directa con valoración fundamental y estrellas"
                    ),
                    "Finviz": st.column_config.LinkColumn(
                        "Finviz",
                        display_text="📊",
                        help="Radiografía fundamental rápida en Finviz"
                    ),
                }
            )
