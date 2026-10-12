export function validateRegistrationField(field, value, password = "") {
  if (field === "username") {
    if (!value) return "Vui lòng nhập tên đăng nhập.";
    if (value.length > 25) return "Tên đăng nhập không được vượt quá 25 ký tự.";
    if (!/[a-zA-Z0-9]/.test(value)) return "Tên đăng nhập phải chứa chữ cái hoặc chữ số.";
    if (/[^a-zA-Z0-9]/.test(value)) return "Tên đăng nhập không được chứa ký tự đặc biệt hoặc dấu cách.";
    if (!/^[a-zA-Z]/.test(value)) return "Tên đăng nhập phải bắt đầu bằng chữ cái.";
    if (value.length < 3) return "Tên đăng nhập phải có tối thiểu 3 ký tự.";
  }
  if (field === "password") {
    if (!value.trim()) return "Mật khẩu không được để trống hoặc chỉ chứa khoảng trắng.";
    if (value.length > 12) return "Mật khẩu không được vượt quá 12 ký tự.";
    if (value.length < 8 || !/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value) || !/[^a-zA-Z0-9]/.test(value))
      return "Mật khẩu phải từ 8 đến 12 ký tự, bao gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt.";
  }
  if (field === "confirmPassword") {
    if (!value) return "Vui lòng xác nhận lại mật khẩu.";
    if (value !== password) return "Mật khẩu xác nhận không trùng khớp.";
  }
  if (field === "contactInfo") {
    if (!value) return "Vui lòng nhập số điện thoại liên hệ.";
    if (!value.startsWith("0")) return "Số điện thoại phải bắt đầu bằng số 0.";
    if (value.length < 10) return "Số điện thoại phải có đủ 10 chữ số.";
    if (value.length > 10) return "Số điện thoại không được vượt quá 10 chữ số.";
  }
  if (field === "agreed" && !value) return "Bạn cần đồng ý với Điều khoản dịch vụ và bảo mật HWID.";
  return undefined;
}
