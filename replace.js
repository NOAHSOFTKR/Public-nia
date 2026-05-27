function replaceall(text) {
    return text
        .replace(/[*_~`]/g, '')
        .replace(/<?:[A-Za-z0-9_]+:(\d{17,19})?\>?/g, '이모지를 보냈어요.')
        .replace(/https?:\/\/[^\s]+/g, "링크를 보냈어요.")
        .replaceAll("ㅎㅇ", "하이")
        .replaceAll("ㅅㄲ", "새끼")
        .replaceAll("ㅂㅇ", "바이")
        .replaceAll("ㅅㅂ", "시발")
        .replaceAll("ㅇㄴ", "아니")
        .replaceAll("ㄹㅇ", "리얼")
        .replaceAll("ㄱㄷ", "기달")
        .replaceAll("ㅁㅊ", "미친")
        .replaceAll("ㅈㅁㅊ", "진미채") // 어쩔 ㅋㅋ
        .replaceAll("ㅈㅉ", "저쩔")
        .replaceAll("ㅈㄴ", "존나")
        .replaceAll("ㅇㅉ", "어쩔")
        .replaceAll("ㅅㄱ", "수고")
        .replaceAll("ㅂㅅ", "병신")
        .replaceAll("ㅄ", "병신")
        .replaceAll("ㄱㅄ", "개병신")
        .replaceAll("ㄱㅂㅅ", "개병신")
        .replaceAll("ㄳ", "감사")
        .replaceAll("ㄱㅅ", "감사")
        .replaceAll("ㄱㄴㄲ", "그니까")
        .replaceAll("ㅆㄱㄴ","쌉가능")
        .replaceAll("ㄱㄴ", "가능")
        .replaceAll("ㄱㅅㄲ", "개새끼")
        .replaceAll("ㅗ", "엿")
        .replaceAll("ㅅㅅ", "섹스")
        .replaceAll("ㄱㅊ", "괜찮")
        .replaceAll("ㄲㅂ", "까비")
        .replaceAll("ㅂㅂ", "바바")
        .replaceAll("ㄷㄷ", "덜덜")
        .replaceAll("ㅊㅇ", "차이");
}

module.exports = { replaceall };
