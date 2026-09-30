import * as customerService from "../services/customerService.js";

/**
 * Handles GET /api/owner/customers
 * Retrieves paginated list of customers for OWNER dashboard.
 */
export async function list(req, res, next) {
  try {
    const { page, limit, search } = req.query || {};
    const result = await customerService.listCustomers({ page, limit, search });
    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Handles GET /api/owner/customers/:customerId
 * Retrieves single customer detail for OWNER.
 */
export async function getDetail(req, res, next) {
  try {
    const { customerId } = req.params;
    const customer = await customerService.getCustomerById(customerId);
    return res.status(200).json({
      customer,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles POST /api/owner/customers
 * Creates customer, customer profile, and initial balance ledger entry transactionally.
 */
export async function create(req, res, next) {
  try {
    const { name, phone, loginIdentifier, password, profilePictureUrl, initialTiffins } = req.body || {};

    const customer = await customerService.createCustomer({
      name,
      phone,
      loginIdentifier,
      password,
      profilePictureUrl,
      initialTiffins,
      actorId: req.user.id,
    });

    return res.status(201).json({
      message: "Customer created successfully",
      customer,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handles PATCH /api/owner/customers/:customerId
 * Updates basic customer profile (name, phone, profilePictureUrl).
 */
export async function update(req, res, next) {
  try {
    const { customerId } = req.params;
    const customer = await customerService.updateCustomer(customerId, req.body || {}, req.user.id);

    return res.status(200).json({
      message: "Customer updated successfully",
      customer,
    });
  } catch (error) {
    next(error);
  }
}
