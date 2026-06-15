import streamlit as st
import yfinance as yf
import pandas as pd

# Configuración de la página en modo oscuro de un vistazo
st.set_page_config(page_title="JB TERMOMETRO BURSATIL", layout="wide")
st.title("📊 Mi Pizarra JB TERMOMETRO BURSATIL")
st.subheader("Detecta puntos clave para optimizar tus activos")

# Lista de tickers iniciales por defecto (puedes cambiarlos en la web)
tickers_por_defecto = ["AMZN", "DIS", "GOOG", "HOOD", "JEPQ", "META", "MSFT", "NVDA", "SPY", "QQQM"]
tickers_input = st.text_input("Añade o modifica tus tickers (separados por comas):", value=", ".join(tickers_por_defecto))
tickers = [t.strip().upper() for t in tickers_input.split(",") if t.strip()]

datos_pizarra = []

if st.button("🔄 Actualizar Datos Ahora") or tickers:
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
            
            # RSI (14)
            delta = df['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs.iloc[-1]))
            
            # Tipo de activo simplificado
            info = ticker.info
            tipo = "ETF" if "fund" in info.get("quoteType", "").lower() else "Stock"
            
            # Lógica de Posición de Medias Móviles
            sobre = []
            debajo = []
            for nombre, valor in [("SMA200", sma200), ("SMA100", sma100), ("SMA50", sma50), ("SMA20", sma20)]:
                if precio_actual > valor:
                    sobre.append(nombre)
                else:
                    debajo.append(nombre)
            
            if len(debajo) == 4:
                posicion_str = "Debajo de todas las SMA"
            elif len(sobre) == 4:
                posicion_str = "Sobre todas las SMA"
            else:
                posicion_str = f"Sobre {', '.join(sobre)} | Debajo {', '.join(debajo)}"

            # Lógica de la Señal
            if precio_actual > sma50 and rsi < 60:
                senal = "🟢 Interesante"
            else:
                senal = "🟡 A considerar"
                
            # Simulación de Nivel LC
            puntos_sma = (len(sobre) / 4) * 50
            puntos_rsi = (1 - abs(rsi - 45)/55) * 50
            nivel_lc = int(puntos_sma + puntos_rsi)

            datos_pizarra.append({
                "Ticker": ticker_symbol,
                "Tipo": tipo,
                "Precio Actual": f"${precio_actual:.2f}",
                "Cambio %": f"{'+' if cambio_porcentaje > 0 else ''}{cambio_porcentaje:.2f}%",
                "RSI (14)": f"{rsi:.2f}",
                "Posición MAs": posicion_str,
                "Señal": senal,
                "Nivel LC": min(max(nivel_lc, 10), 100)
            })
        except Exception as e:
            pass

    # Renderizar la tabla final bonita
    if datos_pizarra:
        df_pizarra = pd.DataFrame(datos_pizarra)
        st.dataframe(df_pizarra, use_container_width=True, hide_index=True)
