type Props = {
  usi: number
  service: { title: string; status: string; statusRaw: string }
  onDone?: () => void
}

export default function ConnectAmneziaWG({ usi }: Props) {
  return (
    <div>
      <div className="p" style={{ marginTop: 0 }}>
        Подключение через приложение Amnezia. Мы добавим здесь кнопки установки приложения, скачивания конфига и QR-код.
      </div>

      <div className="pre" style={{ marginTop: 10 }}>
        USI: <b>{usi}</b>
        <br />
        Скоро: “Скачать конфиг”, “Показать QR”, “Инструкция по шагам”.
      </div>
    </div>
  )
}