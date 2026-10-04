// Заглушка Anthropic SDK: в HTML-версии нет сервера и ключа, поэтому AI выключен
// (aiEnabled() === false) и Table Mode работает на сиде и шаблонном итоге — как без ANTHROPIC_API_KEY.

class APIError extends Error {
  status?: number;
}
class BadRequestError extends APIError {}

export default class Anthropic {
  static APIError = APIError;
  static BadRequestError = BadRequestError;

  constructor() {
    throw new Error('AI недоступен в HTML-версии');
  }
}

export const zodOutputFormat = () => {
  throw new Error('AI недоступен в HTML-версии');
};
export const betaZodOutputFormat = zodOutputFormat;
