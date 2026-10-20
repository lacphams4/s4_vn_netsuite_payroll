// Dữ liệu dùng chung cho test lõi: provider tham số mặc định (VietnamDefaults), có thể thêm dòng.
const path = require("path");
const CORE = path.join(__dirname, "../../src/FileCabinet/SuiteScripts/com.s4.vnpayroll/core");
const core = (name) => require(path.join(CORE, name));
const Defaults = core("VietnamDefaults");
const Provider = core("StatutoryParameterProvider");

function provider(extra = {}) {
  return Provider.create({
    params: Defaults.params.concat(extra.params || []),
    brackets: Defaults.brackets.concat(extra.brackets || []),
    components: Defaults.components.concat(extra.components || []),
  });
}

module.exports = { core, provider, Defaults };
