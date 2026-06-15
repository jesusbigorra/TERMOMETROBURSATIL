import streamlit as st
import yfinance as yf
import pandas as pd
import os
import urllib.request
import urllib.parse
import json
from streamlit_searchbox import st_searchbox

# Configuración de la página en modo oscuro de un vistazo
st.set_page_config(page_title="JB TERMOMETRO BURSATIL", page_icon="🌡️", layout="wide")

# =========================================================================
# 🔍 MOTOR DINÁMICO: CONSULTA A YAHOO FINANCE MIENTRAS ESCRIBES
# =========================================================================
def buscar_ticker_en_tiempo_real(search_term: str):
    if not search_term or len(search_term) < 2:
        return []
    try:
        query_con_formato = urllib.parse.quote(search_term.strip())
        url = f"https://query1.finance.yahoo.com/v1/finance/search?q={query_con_formato}&quotesCount=8&newsCount=0"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode())
            quotes = data.get("quotes", [])
            
            sugerencias = []
            for item in quotes:
                symbol = item.get("symbol")
                name = item.get("shortname", item.get("longname", ""))
                
                if symbol and ("." not in symbol or "-USD" in symbol):
                    label_visual = f"➕ {symbol.upper()} | {name}"
                    sugerencias.append((label_visual, symbol.upper()))
            return sugerencias
    except Exception:
        return []

# =========================================================================
# 🔐 CONFIGURACIÓN DE SEGURIDAD (ACCESO PERSONALIZADO)
# =========================================================================
CONTRASEÑA_CORRECTA = "JB2026"

st.sidebar.title("🔐 Control de Acceso")

# Renderizado de tu Logotipo Oficial en la barra lateral
if os.path.exists("logo.png"):
    st.sidebar.image("logo.png", use_container_width=True)
elif os.path.exists("logo.jpg"):
    st.sidebar.image("logo.jpg", use_container_width=True)

password_input = st.sidebar.text_input("Introduce la Clave de Acceso:", type="password")

if password_input != CONTRASEÑA_CORRECTA:
    st.sidebar.error("❌ Contraseña Incorrecta")
    st.title("🌡️ JB TERMOMETRO BURSATIL")
    st.warning("⚠️ Acceso Restringido. Introduce la clave secreta en la barra lateral para desbloquear el sistema de indicadores bursátiles en tiempo real.")
    st.info("💡 Si eres un usuario autorizado y no tienes tu código de acceso, ponte en contacto con Jesús Bigorra.")
else:
    st.sidebar.success("🔓 Acceso Concedido")
    
    st.title("🌡️📈 Mi Pizarra JB TERMOMETRO BURSATIL")
    st.subheader("Detecta puntos clave para optimizar tus activos")

    if "radar_tickers" not in st.session_state:
        st.session_state.radar_tickers = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"]

    st.write("### 📡 Panel de Control del Radar JB")
    
    ticker_seleccionado = st_searchbox(
        buscar_ticker_en_tiempo_real,
        placeholder="🔍 Pon el nombre de tu empresa o tu ETF...",
        key="buscador_radar_jb"
    )
    
    if ticker_seleccionado:
        if ticker_seleccionado not in st.session_state.radar_tickers:
            st.session_state.radar_tickers.append(ticker_seleccionado)
            st.toast(f"✅ ¡{ticker_seleccionado} añadido al Radar!")
            st.rerun()

    tickers_filtrados = st.multiselect(
        "📋 Activos bajo la lupa en tu Radar actual (Haz clic en la 'X' de cualquiera para eliminarlo permanentemente):",
        options=st.session_state.radar_tickers,
        default=st.session_state.radar_tickers
    )

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
                    
                precio_actual = df['Close'].iloc[-1]
                precio_anterior = df['Close'].iloc[-2]
                cambio_porcentaje = ((precio_actual - precio_anterior) / precio_anterior) * 100
                
                sma20 = df['Close'].rolling(window=20).mean().iloc[-1]
                sma50 = df['Close'].rolling(window=50).mean().iloc[-1]
                sma100 = df['Close'].rolling(window=100).mean().iloc[-1]
                sma200 = df['Close'].rolling(window=200).mean().iloc[-1]
                
                delta = df['Close'].diff()
                gain = delta.clip(lower=0)
                loss = -delta.clip(upper=0)
                ema_gain = gain.ewm(alpha=1/14, adjust=False).mean()
                ema_loss = loss.ewm(alpha=1/14, adjust=False).mean()
                rs = ema_gain / ema_loss
                rsi = 100 - (100 / (1 + rs.iloc[-1]))
                
                info = ticker.info
                quote_type = info.get("quoteType", "").upper()
                tipo = "ETF" if quote_type == "ETF" else "Stock"
                
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

                puntos_rsi = (70 - rsi) * 1.25
                puntos_rsi = max(0.0, min(50.0, puntos_rsi))

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

                url_yahoo = f"https://es-us.finanzas.yahoo.com/chart/{ticker_symbol}"
                url_finviz = f"https://finviz.com/quote.ashx?t={ticker_symbol}"
                
                if tipo == "ETF":
                    url_etf = f"https://www.etf.com/{ticker_symbol}"
                else:
                    url_etf = f"https://www.etf.com/search?q={ticker_symbol}"
                
                exchange = info.get("exchange", "").upper()
                if tipo == "ETF":
                    exch_code = "xnas" if ("NAS" in exchange or "NMS" in exchange) else ("bats" if "BATS" in exchange else "arcx")
                    url_mstar = f"https://www.morningstar.com/etfs/{exch_code}/{ticker_symbol.lower()}/quote"
                else:
                    exch_code = "xnys" if ("NYE" in exchange or "NYQ" in exchange or "NYSE" in exchange) else "xnas"
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
            except Exception:
                pass

        # Renderizado de la tabla interactiva de Tickers
        if datos_pizarra:
            df_pizarra = pd.DataFrame(datos_pizarra)
            st.dataframe(
                df_pizarra, 
                use_container_width=True, 
                hide_index=True,
                column_config={
                    "Ticker": st.column_config.LinkColumn("Ticker", display_text=r"https://es-us\.finanzas\.yahoo\.com/chart/(.*)"),
                    "ETF.com": st.column_config.LinkColumn("ETF.com", display_text="🟢"),
                    "M-Star": st.column_config.LinkColumn("M-Star", display_text="🔴"),
                    "Finviz": st.column_config.LinkColumn("Finviz", display_text="📊"),
                }
            )

    # =========================================================================
    # 📚 ACADEMIA JB: VIDEOS Y LECTURAS ESTRATÉGICAS (ANCLADO AL FONDO)
    # =========================================================================
    st.markdown("---")
    with st.expander("📚 Academia JB: Videos y Lecturas Estratégicas", expanded=False):
        col_vid, col_lib = st.columns([1.2, 1])
        
        with col_vid:
            st.write("### 🎥 Clases Magistrales y Videos de Cabecera")
            
            # Selector dinámico para reproducir videos de alta definición de uno en uno
            opciones_video = {
                "📈 Crecimiento: Invertir $10K en ETFs a los 30 años (Eduardo ETF)": "https://www.youtube.com/watch?v=6GYgP63GmaM",
                "👑 Mentalidad: Warren Buffett para Principiantes | 6 Reglas de Oro": "https://www.youtube.com/watch?v=Sc2qegZw1_g",
                "🛑 Realidad: ¿Cómo hacer dinero rápido y evitar la pobreza?": "https://www.youtube.com/watch?v=ivzT3cWIgDc",
                "🤖 Innovación: Experto en IA - Si no usas IA, estás en riesgo": "https://www.youtube.com/watch?v=WbK7t89QrIY",
                "📊 Educación: Guía Maestra de Fondos Indexados (Adrián Sáenz)": "https://www.youtube.com/watch?v=LfusDfTljo4"
            }
            video_elegido = st.selectbox("🎯 Elige la lección que deseas repasar en pantalla:", list(opciones_video.keys()))
            st.video(opciones_video[video_elegido])
            
        with col_lib:
            st.write("### 📖 Biblioteca Fundamental de Inversión")
            st.write("Haz clic sobre el botón de cualquier manual estratégico para abrir o descargar el PDF oficial instantáneamente:")
            st.write("") # Pequeño espacio estético
            
            # Enlaces de descarga estilizados directos de tus libros PDF aportados
            st.markdown("""
            - 📘 **El Hombre más Rico de Babilonia** — *George S. Clason* 👉 [[Abrir Libro en PDF]](https://dn710007.ca.archive.org/0/items/darkmaind_202405/El_hombre_mas_rico_de_Babilonia_George_S_Clason.pdf)
            
            - 📙 **Los 7 Hábitos de la Gente Altamente Efectiva** — *Stephen Covey* 👉 [[Abrir Libro en PDF]](https://www.colomos.ceti.mx/documentos/goe/los7HabitosGenteAltamenteEfectiva.pdf)
            
            - 📗 **Cómo Piensan los Ricos (La Psicología del Dinero)** — *Morgan Housel* 👉 [[Abrir Libro en PDF]](https://www.marcialpons.es/media/pdf/47530_Como_piensan_los_ricos.pdf)
            """)
