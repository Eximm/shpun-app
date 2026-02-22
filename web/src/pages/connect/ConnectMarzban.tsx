type Props = {
  usi: number
  service: { title: string; status: string; statusRaw: string }
  onDone?: () => void
}

export default function ConnectMarzban({ usi }: Props) {
  return (
    <div>
      <div className="p" style={{ marginTop: 0 }}>
        Подключение через клиент Marzban. Добавим авто-импорт подписки, копирование ссылки и QR-код.
      </div>

      <div className="pre" style={{ marginTop: 10 }}>
        USI: <b>{usi}</b>
        <br />
        Скоро: “Открыть в приложении”, “Скопировать ссылку”, “Показать QR”.
      </div>
    </div>
  )
}