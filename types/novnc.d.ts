declare module "@novnc/novnc" {
  type NoVncEvent = CustomEvent

  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string,
      options?: { shared?: boolean }
    )

    compressionLevel: number
    focusOnClick: boolean
    qualityLevel: number
    resizeSession: boolean
    scaleViewport: boolean

    addEventListener(
      type:
        | "connect"
        | "credentialsrequired"
        | "disconnect"
        | "securityfailure",
      listener: (event: NoVncEvent) => void
    ): void
    disconnect(): void
  }
}
