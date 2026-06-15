import streamlit as st
import yfinance as yf
import pandas as pd
import os
import urllib.request
import urllib.parse
import json

# Configuración de la página en modo oscuro
st.set_page_config(page_title="JB TERMOMETRO BURSATIL", page_icon="🌡️", layout="wide")

# =========================================================================
# 🔍 MOTOR DE BÚSQUEDA PROFESIONAL DE TICKERS (ESTILO FINVIZ / MORNINGSTAR)
# =========================================================================
def buscar_ticker_inteligente(query):
    if not query or len(query) < 2:
        return []
    try:
        # Limpiamos y codificamos la consulta para la web
        query_con_formato = urllib.parse.quote(query.strip())
        # Pedimos 10 resultados para garantizar que no se pierda el ticker principal de EE.UU.
        url = f"https://query1.finance.yahoo.com/v1/finance/search?q={query_con_formato}&quotesCount=10&newsCount=0"
        
        # Simulación de navegador de alta seguridad para evitar bloqueos del servidor
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            quotes = data.get("quotes", [])
            
            sugerencias = []
            for item in quotes:
                symbol = item.get("symbol")
                name = item.get("shortname", item.get("longname", ""))
                exchange = item.get("exchange", "").upper()
                
                # PRIORIDAD DE WALL STREET: Filtramos mercados secundarios confusos 
                # Pero permitimos cripto (como BTC-USD) y los mercados principales americanos
                if symbol and ("." not in symbol or "-USD" in symbol):
                    sugerencias.append({
                        "ticker": symbol.upper(),
                        "nombre": name if name else symbol,
                        "bolsa": exchange
                    })
            return sugerencias[:4] # Devolvemos el Top 4 de coincidencias más limpias
    except Exception:
        return []

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
    
    st.title("🌡️📈 Mi Pizarra JB TERMOMETRO BURSATIL")
    st.subheader("Detecta puntos clave para optimizar tus activos")

    # 📡 CONTROL AUTOMATIZADO DEL RADAR JB (MEMORIA INTERNA)
    if "radar_tickers" not in st.session_state:
        st.session_state.radar_tickers = ["SPYM", "QQQM", "SCHD", "VXUS", "SCHG", "JEPQ", "MSFT", "NVDA", "KO", "WMT"]

    st.write("### 📡 Panel de Control del Radar JB")
    
    # =========================================================================
    # 🎯 BUSCADOR EVOLUCIONADO: INTERFAZ DE 1-CLIC
    # =========================================================================
    texto_busqueda = st.text_input("🔍 Pon el nombre de tu empresa o tu ETF:").strip()
    
    if texto_busqueda:
        resultados = buscar_ticker_inteligente(texto_busqueda)
        
        if resultados:
            st.write("🎯 **Sugerencias del mercado (Haz clic para agregar directamente al Radar):**")
            
            # Diseñamos una fila de botones horizontales muy elegantes y limpios
            cols_sug = st.columns(len(resultados))
            for i, sug in enumerate(resultados):
                with cols_sug[i]:
                    label_boton = f"➕ {sug['ticker']}\n({sug['nombre'][:18]})"
                    if st.button(label_boton, key=f"sug_{sug['ticker']}", use_container_width=True):
                        if sug['ticker'] not in st.session_state.radar_tickers:
                            st.session_state.radar_tickers.append(sug['ticker'])
                            st.toast(f"✅ ¡{sug['ticker']} añadido al Radar!")
                            st.rerun()
        else:
            st.caption("Buscando coincidencias en Wall Street... Si no aparece, prueba escribiendo el Ticker directo.")

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

                # Evaluation Estricta de Señales
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

                # Links multi-plataforma quirúrgicos
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
            except Exception as e:
                pass

        # Renderizado de la tabla con los hipervínculos ocultos en los iconos
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
