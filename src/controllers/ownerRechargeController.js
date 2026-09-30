import * as rechargeService from "../services/rechargeService.js";

export async function recharge(req, res, next) {
  try {
    const { customerId } = req.params;
    const actorId = req.user.id;
    const result = await rechargeService.rechargeCustomer(customerId, req.body, actorId);
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
